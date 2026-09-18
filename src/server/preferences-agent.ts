import { Agent } from 'agents';
import {
  preferencesSchema,
  topicProposalSchema,
  topicProposalRequestSchema,
  type Preferences,
} from '../shared/preferences';
import {
  briefingArchiveEntrySchema,
  briefingRunInputSchema,
  briefingSchema,
  type Briefing,
  type BriefingArchiveEntry,
} from '../shared/briefings';
import {
  briefingCollectionResultSchema,
  briefingCollectionSnapshotSchema,
  defaultBriefingCollectionBudget,
  type BriefingCollectionResult,
  type BriefingCollectionSnapshot,
} from './briefing-collection';
import {
  buildTopicProposalInput,
  parseTopicProposalResponse,
  topicProposalModel,
  type StoredTopicProposal,
} from './topic-proposals';
import type { SearxngContainer } from './searxng-container';

/** Bindings used by the singleton preferences Agent. */
export type PreferencesAgentEnv = {
  AI?: Ai;
  PERSONAL_BRIEFING: DurableObjectNamespace<PersonalBriefingAgent>;
  SEARXNG: DurableObjectNamespace<SearxngContainer>;
  PREFERENCES_DIAGNOSTICS_ENABLED?: string;
};

/** Absence is distinct from an unsaved set of suggested first-run defaults. */
export type StoredPreferences =
  { configured: false } | { configured: true; preferences: Preferences };

/** Explicit replacement result that remains structured across Durable Object RPC. */
export type PreferenceReplaceResult =
  | { ok: true; preferences: Preferences }
  | { ok: false; currentRevision: number };

/** Outcome of creating a reviewable topic proposal. */
export type TopicProposalCreateResult =
  | { ok: true; proposal: StoredTopicProposal }
  | { ok: false; error: string; diagnostic?: string };

/** Outcome of applying or discarding a stored topic proposal. */
export type TopicProposalActionResult =
  | { ok: true; preferences?: Preferences }
  | { ok: false; error: string; currentRevision?: number };

/** Outcome of recording an idempotent manual briefing run snapshot. */
export type BriefingRunStartResult =
  { ok: true; created: boolean } | { ok: false; error: string };

/** Outcome of atomically publishing an already composed briefing. */
export type BriefingPublishResult =
  | { ok: true; briefing: Briefing; idempotent: boolean }
  | { ok: false; error: string };

/** Stable owner key supplied at the Worker edge; Access `sub` will replace the local placeholder. */
export type UserId = string;

/** Singleton durable owner of preference state. Future conversations and briefings share this Agent. */
export class PersonalBriefingAgent extends Agent<PreferencesAgentEnv> {
  /** Reads the validated preferences document without creating a first-run record. */
  readPreferences(userId: UserId): StoredPreferences {
    this.ensureSchema();

    return this.readStoredPreferences(userId);
  }

  /** Validates and atomically replaces the document when the supplied revision is current. */
  replacePreferences(
    document: unknown,
    expectedRevision: number,
    userId: UserId,
  ): PreferenceReplaceResult {
    this.ensureSchema();
    const preferences = preferencesSchema.parse(document);

    return this.ctx.storage.transactionSync(() => {
      const existing = this.readStoredPreferences(userId);
      const currentRevision = existing.configured
        ? existing.preferences.revision
        : 0;

      if (expectedRevision !== currentRevision)
        return { ok: false, currentRevision };
      const saved = { ...preferences, revision: currentRevision + 1 };

      this.ctx.storage.sql.exec(
        `INSERT INTO preferences (user_id, revision, document) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET revision = excluded.revision, document = excluded.document`,
        userId,
        saved.revision,
        JSON.stringify(saved),
      );

      return { ok: true, preferences: saved };
    });
  }

  /** Creates and stores a model-generated topic proposal without changing preferences. */
  async createTopicProposal(
    input: unknown,
    userId: UserId,
  ): Promise<TopicProposalCreateResult> {
    this.ensureSchema();
    const request = topicProposalRequestSchema.parse(input);
    const existing = this.readStoredPreferences(userId);

    if (!existing.configured)
      return {
        ok: false,
        error: 'Save preferences before requesting a proposal.',
      };

    if (request.scope.operation === 'edit-topic') {
      const topicId = request.scope.topicId;

      if (!existing.preferences.topics.some((topic) => topic.id === topicId)) {
        return { ok: false, error: 'The selected topic no longer exists.' };
      }
    }

    if (this.env.AI === undefined)
      return {
        ok: false,
        error: 'Workers AI is not configured for this Worker.',
      };

    let response: unknown;

    try {
      response = await this.env.AI.run(
        topicProposalModel,
        buildTopicProposalInput(request, existing.preferences),
      );
      const proposal = parseTopicProposalResponse(
        response,
        request,
        existing.preferences,
      );

      this.storeTopicProposal(proposal, userId);

      return { ok: true, proposal };
    } catch (caught) {
      return {
        ok: false,
        error:
          'Could not create a valid topic proposal. Please revise the request and try again.',
        diagnostic: proposalDiagnostic(caught, response),
      };
    }
  }

  /** Lists pending proposals so review survives a browser reload. */
  listPendingTopicProposals(userId: UserId): StoredTopicProposal[] {
    this.ensureSchema();

    return [
      ...this.ctx.storage.sql.exec<{
        proposal: string;
        prompt_version: string;
      }>(
        `SELECT proposal, prompt_version FROM topic_proposals WHERE user_id = ? AND status = 'pending' ORDER BY created_at ASC`,
        userId,
      ),
    ].map((row) => this.parseStoredTopicProposal(row));
  }

  /** Applies a pending proposal after checking its base revision and scope again. */
  applyTopicProposal(
    proposalId: string,
    userId: UserId,
  ): TopicProposalActionResult {
    this.ensureSchema();

    return this.ctx.storage.transactionSync(() => {
      const stored = this.readPendingTopicProposal(proposalId, userId);

      if (stored === undefined)
        return { ok: false, error: 'The proposal is no longer available.' };
      const existing = this.readStoredPreferences(userId);

      if (!existing.configured)
        return { ok: false, error: 'Preferences are not configured.' };

      if (stored.proposal.unresolvedQuestions.length > 0)
        return { ok: false, error: 'Clarify the proposal before applying it.' };

      if (stored.proposal.baseRevision !== existing.preferences.revision) {
        return {
          ok: false,
          error: 'Preferences changed after this proposal was created.',
          currentRevision: existing.preferences.revision,
        };
      }

      const preferences = preferencesSchema.parse(
        this.applyProposalToPreferences(existing.preferences, stored.proposal),
      );
      const saved = {
        ...preferences,
        revision: existing.preferences.revision + 1,
      };

      this.ctx.storage.sql.exec(
        `UPDATE preferences SET revision = ?, document = ? WHERE user_id = ?`,
        saved.revision,
        JSON.stringify(saved),
        userId,
      );
      this.ctx.storage.sql.exec(
        `UPDATE topic_proposals SET status = 'applied' WHERE id = ? AND user_id = ?`,
        proposalId,
        userId,
      );

      return { ok: true, preferences: saved };
    });
  }

  /** Discards one pending proposal without changing preferences. */
  discardTopicProposal(
    proposalId: string,
    userId: UserId,
  ): TopicProposalActionResult {
    this.ensureSchema();
    const result = this.ctx.storage.sql.exec(
      `UPDATE topic_proposals SET status = 'discarded' WHERE id = ? AND user_id = ? AND status = 'pending'`,
      proposalId,
      userId,
    );

    if (result.rowsWritten === 0)
      return { ok: false, error: 'The proposal is no longer available.' };

    return { ok: true };
  }

  /** Records one manual run against its preference revision without beginning collection. */
  startBriefingRun(input: unknown, userId: UserId): BriefingRunStartResult {
    this.ensureSchema();
    const run = briefingRunInputSchema.parse(input);
    const preferences = this.readStoredPreferences(userId);

    if (!preferences.configured)
      return {
        ok: false,
        error: 'Save preferences before starting a briefing.',
      };

    if (preferences.preferences.revision !== run.preferenceRevision) {
      return {
        ok: false,
        error: 'Preferences changed before this briefing run could start.',
      };
    }
    const snapshot = briefingCollectionSnapshotSchema.parse({
      runId: run.runId,
      preferenceRevision: run.preferenceRevision,
      preferences: preferences.preferences,
      budget: defaultBriefingCollectionBudget,
    });

    return this.ctx.storage.transactionSync(() => {
      const existing = [
        ...this.ctx.storage.sql.exec<{ user_id: string }>(
          `SELECT user_id FROM briefing_runs WHERE id = ?`,
          run.runId,
        ),
      ][0];

      if (existing !== undefined)
        return existing.user_id === userId
          ? { ok: true, created: false }
          : { ok: false, error: 'Briefing run ID is already in use.' };

      this.ctx.storage.sql.exec(
        `INSERT INTO briefing_runs (id, user_id, preference_revision, status, collection_snapshot, created_at) VALUES (?, ?, ?, 'running', ?, datetime('now'))`,
        run.runId,
        userId,
        run.preferenceRevision,
        JSON.stringify(snapshot),
      );

      return { ok: true, created: true };
    });
  }

  /** Reads the immutable preferences and budgets captured when an active run started. */
  readBriefingCollectionSnapshot(
    runId: string,
    userId: UserId,
  ): BriefingCollectionSnapshot | undefined {
    this.ensureSchema();
    briefingRunInputSchema.shape.runId.parse(runId);
    const row = [
      ...this.ctx.storage.sql.exec<{ collection_snapshot: string | null }>(
        `SELECT collection_snapshot FROM briefing_runs WHERE id = ? AND user_id = ? AND status = 'running'`,
        runId,
        userId,
      ),
    ][0];

    if (row?.collection_snapshot === null || row === undefined)
      return undefined;

    return briefingCollectionSnapshotSchema.parse(
      JSON.parse(row.collection_snapshot) as unknown,
    );
  }

  /** Replaces temporary candidate evidence and partial-failure details for one active run. */
  storeBriefingCollection(
    runId: string,
    value: unknown,
    userId: UserId,
  ): boolean {
    this.ensureSchema();
    briefingRunInputSchema.shape.runId.parse(runId);
    const collection = briefingCollectionResultSchema.parse(value);

    return this.ctx.storage.transactionSync(() => {
      const run = [
        ...this.ctx.storage.sql.exec<{ collection_snapshot: string | null }>(
          `SELECT collection_snapshot FROM briefing_runs WHERE id = ? AND user_id = ? AND status = 'running'`,
          runId,
          userId,
        ),
      ][0];

      if (run?.collection_snapshot === null || run === undefined) return false;

      this.ctx.storage.sql.exec(
        `DELETE FROM briefing_candidates WHERE run_id = ?`,
        runId,
      );
      this.ctx.storage.sql.exec(
        `UPDATE briefing_runs SET collection_failures = ? WHERE id = ?`,
        JSON.stringify(collection.failures),
        runId,
      );

      for (const candidate of collection.candidates) {
        this.ctx.storage.sql.exec(
          `INSERT INTO briefing_candidates (run_id, source_url, topic_ids, story, evidence, evidence_tier, created_at) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`,
          runId,
          candidate.story.sourceUrl,
          JSON.stringify(candidate.topicIds),
          JSON.stringify(candidate.story),
          JSON.stringify(candidate.evidence),
          candidate.evidenceTier,
        );
      }

      return true;
    });
  }

  /** Reads temporary evidence and partial collection failures while the run remains active. */
  readBriefingCollection(
    runId: string,
    userId: UserId,
  ): BriefingCollectionResult | undefined {
    this.ensureSchema();
    briefingRunInputSchema.shape.runId.parse(runId);
    const run = [
      ...this.ctx.storage.sql.exec<{ collection_failures: string | null }>(
        `SELECT collection_failures FROM briefing_runs WHERE id = ? AND user_id = ? AND status = 'running'`,
        runId,
        userId,
      ),
    ][0];

    if (run?.collection_failures === null || run === undefined)
      return undefined;

    const candidates = [
      ...this.ctx.storage.sql.exec<{
        topic_ids: string;
        story: string;
        evidence: string;
        evidence_tier: 'article' | 'description' | 'headline-only';
      }>(
        `SELECT candidate.topic_ids, candidate.story, candidate.evidence, candidate.evidence_tier FROM briefing_candidates AS candidate INNER JOIN briefing_runs AS run ON run.id = candidate.run_id WHERE candidate.run_id = ? AND run.user_id = ? AND run.status = 'running' ORDER BY candidate.created_at ASC`,
        runId,
        userId,
      ),
    ].map((row) =>
      briefingCollectionResultSchema.shape.candidates.element.parse({
        topicIds: JSON.parse(row.topic_ids) as unknown,
        story: JSON.parse(row.story) as unknown,
        evidence: JSON.parse(row.evidence) as unknown,
        evidenceTier: row.evidence_tier,
      }),
    );

    return briefingCollectionResultSchema.parse({
      candidates,
      failures: JSON.parse(run.collection_failures) as unknown,
    });
  }

  /** Atomically stores a completed briefing only for its active matching run. */
  publishBriefing(value: unknown, userId: UserId): BriefingPublishResult {
    this.ensureSchema();
    const briefing = briefingSchema.parse(value);

    return this.ctx.storage.transactionSync(() => {
      const run = [
        ...this.ctx.storage.sql.exec<{
          user_id: string;
          preference_revision: number;
          status: 'running' | 'published' | 'failed';
        }>(
          `SELECT user_id, preference_revision, status FROM briefing_runs WHERE id = ?`,
          briefing.runId,
        ),
      ][0];

      if (run === undefined || run.user_id !== userId)
        return { ok: false, error: 'Briefing run is not available.' };

      if (run.preference_revision !== briefing.preferenceRevision) {
        return {
          ok: false,
          error: 'Briefing does not match its run snapshot.',
        };
      }

      if (run.status === 'published') {
        const existing = this.readBriefingByRun(briefing.runId, userId);

        if (existing === undefined)
          return { ok: false, error: 'Published briefing is unavailable.' };

        return { ok: true, briefing: existing, idempotent: true };
      }

      if (run.status !== 'running')
        return { ok: false, error: 'Briefing run cannot be published.' };

      this.ctx.storage.sql.exec(
        `INSERT INTO briefings (run_id, user_id, date, published_at, document) VALUES (?, ?, ?, ?, ?)`,
        briefing.runId,
        userId,
        briefing.date,
        briefing.publishedAt,
        JSON.stringify(briefing),
      );
      this.ctx.storage.sql.exec(
        `DELETE FROM briefing_candidates WHERE run_id = ?`,
        briefing.runId,
      );
      this.ctx.storage.sql.exec(
        `UPDATE briefing_runs SET status = 'published', published_at = ? WHERE id = ? AND user_id = ?`,
        briefing.publishedAt,
        briefing.runId,
        userId,
      );

      return { ok: true, briefing, idempotent: false };
    });
  }

  /** Marks an active run failed and removes its temporary evidence. */
  failBriefingRun(runId: string, userId: UserId): boolean {
    this.ensureSchema();

    return this.ctx.storage.transactionSync(() => {
      const result = this.ctx.storage.sql.exec(
        `UPDATE briefing_runs SET status = 'failed' WHERE id = ? AND user_id = ? AND status = 'running'`,
        runId,
        userId,
      );

      if (result.rowsWritten !== 1) return false;

      this.ctx.storage.sql.exec(
        `DELETE FROM briefing_candidates WHERE run_id = ?`,
        runId,
      );

      return true;
    });
  }

  /** Returns the newest dated published briefing for Today. */
  readLatestBriefing(userId: UserId): Briefing | undefined {
    this.ensureSchema();
    const row = [
      ...this.ctx.storage.sql.exec<{ document: string }>(
        `SELECT document FROM briefings WHERE user_id = ? ORDER BY date DESC, published_at DESC LIMIT 1`,
        userId,
      ),
    ][0];

    if (row === undefined) return undefined;

    return briefingSchema.parse(JSON.parse(row.document) as unknown);
  }

  /** Lists newest-first archive metadata without loading briefing item documents. */
  listBriefingArchive(userId: UserId): BriefingArchiveEntry[] {
    this.ensureSchema();

    return [
      ...this.ctx.storage.sql.exec<{
        run_id: string;
        date: string;
        published_at: string;
        document: string;
      }>(
        `SELECT run_id, date, published_at, document FROM briefings WHERE user_id = ? ORDER BY date DESC, published_at DESC`,
        userId,
      ),
    ].map((row) => {
      const briefing = briefingSchema.parse(
        JSON.parse(row.document) as unknown,
      );

      return briefingArchiveEntrySchema.parse({
        runId: row.run_id,
        date: row.date,
        completeness: briefing.completeness,
        itemCount: briefing.items.length,
        publishedAt: row.published_at,
      });
    });
  }

  /** Reads the stored row after schema initialization without triggering another migration check. */
  private readStoredPreferences(userId: UserId): StoredPreferences {
    const row = [
      ...this.sql<{
        document: string;
      }>`SELECT document FROM preferences WHERE user_id = ${userId}`,
    ][0];

    if (row === undefined) return { configured: false };

    return {
      configured: true,
      preferences: preferencesSchema.parse(JSON.parse(row.document) as unknown),
    };
  }

  /** Reads one stored briefing only inside an already-open storage transaction. */
  private readBriefingByRun(
    runId: string,
    userId: UserId,
  ): Briefing | undefined {
    const row = [
      ...this.ctx.storage.sql.exec<{ document: string }>(
        `SELECT document FROM briefings WHERE run_id = ? AND user_id = ?`,
        runId,
        userId,
      ),
    ][0];

    if (row === undefined) return undefined;

    return briefingSchema.parse(JSON.parse(row.document) as unknown);
  }

  /** Stores the already validated proposal payload for later explicit review. */
  private storeTopicProposal(
    proposal: StoredTopicProposal,
    userId: UserId,
  ): void {
    this.ctx.storage.sql.exec(
      `INSERT INTO topic_proposals (id, user_id, base_revision, proposal, prompt_version, status, created_at) VALUES (?, ?, ?, ?, ?, 'pending', datetime('now'))`,
      proposal.proposal.id,
      userId,
      proposal.proposal.baseRevision,
      JSON.stringify(proposal.proposal),
      proposal.promptVersion,
    );
  }

  /** Reads one pending stored proposal, scoped to its durable user owner. */
  private readPendingTopicProposal(
    proposalId: string,
    userId: UserId,
  ): StoredTopicProposal | undefined {
    const row = [
      ...this.ctx.storage.sql.exec<{
        proposal: string;
        prompt_version: string;
      }>(
        `SELECT proposal, prompt_version FROM topic_proposals WHERE id = ? AND user_id = ? AND status = 'pending'`,
        proposalId,
        userId,
      ),
    ][0];

    if (row === undefined) return undefined;

    return this.parseStoredTopicProposal(row);
  }

  /** Validates proposal data read back from SQLite before returning it across RPC. */
  private parseStoredTopicProposal(row: {
    proposal: string;
    prompt_version: string;
  }): StoredTopicProposal {
    return {
      proposal: topicProposalSchema.parse(JSON.parse(row.proposal) as unknown),
      promptVersion: row.prompt_version,
    };
  }

  /** Produces the only allowed topic-scoped preference mutation for a proposal. */
  private applyProposalToPreferences(
    preferences: Preferences,
    proposal: StoredTopicProposal['proposal'],
  ): Preferences {
    if (proposal.scope.operation === 'add-topic') {
      if (
        preferences.topics.some(
          (topic) => topic.id === proposal.proposedTopic.id,
        )
      )
        throw new Error('The proposed topic ID now exists.');

      return {
        ...preferences,
        topics: [...preferences.topics, proposal.proposedTopic],
      };
    }

    const topicId = proposal.scope.topicId;
    const topics = preferences.topics.map((topic) =>
      topic.id === topicId ? proposal.proposedTopic : topic,
    );

    if (!topics.some((topic) => topic.id === topicId))
      throw new Error('The selected topic no longer exists.');

    return { ...preferences, topics };
  }

  /** Applies idempotent, versioned schema migrations before every public operation. */
  private ensureSchema(): void {
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec(
        `CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)`,
      );
      const hasMigration = (version: number) =>
        [
          ...this.ctx.storage.sql.exec<{ version: number }>(
            `SELECT version FROM schema_migrations WHERE version = ?`,
            version,
          ),
        ].length !== 0;

      if (!hasMigration(2)) {
        if (hasMigration(1)) {
          this.ctx.storage.sql.exec(
            `ALTER TABLE preferences RENAME TO preferences_v1`,
          );
          this.ctx.storage.sql.exec(
            `CREATE TABLE preferences (user_id TEXT PRIMARY KEY, revision INTEGER NOT NULL, document TEXT NOT NULL)`,
          );
          this.ctx.storage.sql.exec(
            `INSERT INTO preferences (user_id, revision, document) SELECT 'single-user', revision, document FROM preferences_v1 WHERE singleton = 1`,
          );
          this.ctx.storage.sql.exec(`DROP TABLE preferences_v1`);
        } else {
          this.ctx.storage.sql.exec(
            `CREATE TABLE preferences (user_id TEXT PRIMARY KEY, revision INTEGER NOT NULL, document TEXT NOT NULL)`,
          );
        }
        this.ctx.storage.sql.exec(
          `INSERT INTO schema_migrations (version, applied_at) VALUES (2, datetime('now'))`,
        );
      }

      if (!hasMigration(3)) {
        this.ctx.storage.sql.exec(
          `CREATE TABLE topic_proposals (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, base_revision INTEGER NOT NULL, proposal TEXT NOT NULL, prompt_version TEXT NOT NULL, status TEXT NOT NULL CHECK (status IN ('pending', 'applied', 'discarded')), created_at TEXT NOT NULL)`,
        );
        this.ctx.storage.sql.exec(
          `CREATE INDEX topic_proposals_pending_by_user ON topic_proposals (user_id, status, created_at)`,
        );
        this.ctx.storage.sql.exec(
          `INSERT INTO schema_migrations (version, applied_at) VALUES (3, datetime('now'))`,
        );
      }

      if (!hasMigration(4)) {
        this.ctx.storage.sql.exec(
          `CREATE TABLE briefing_runs (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, preference_revision INTEGER NOT NULL, status TEXT NOT NULL CHECK (status IN ('running', 'published', 'failed')), created_at TEXT NOT NULL, published_at TEXT)`,
        );
        this.ctx.storage.sql.exec(
          `CREATE TABLE briefings (run_id TEXT PRIMARY KEY, user_id TEXT NOT NULL, date TEXT NOT NULL, published_at TEXT NOT NULL, document TEXT NOT NULL, FOREIGN KEY (run_id) REFERENCES briefing_runs(id))`,
        );
        this.ctx.storage.sql.exec(
          `CREATE INDEX briefings_latest_by_user ON briefings (user_id, date DESC, published_at DESC)`,
        );
        this.ctx.storage.sql.exec(
          `INSERT INTO schema_migrations (version, applied_at) VALUES (4, datetime('now'))`,
        );
      }

      if (hasMigration(5)) return;
      this.ctx.storage.sql.exec(
        `ALTER TABLE briefing_runs ADD COLUMN collection_snapshot TEXT`,
      );
      this.ctx.storage.sql.exec(
        `ALTER TABLE briefing_runs ADD COLUMN collection_failures TEXT`,
      );
      this.ctx.storage.sql.exec(
        `CREATE TABLE briefing_candidates (run_id TEXT NOT NULL, source_url TEXT NOT NULL, topic_ids TEXT NOT NULL, story TEXT NOT NULL, evidence TEXT NOT NULL, evidence_tier TEXT NOT NULL CHECK (evidence_tier IN ('article', 'description', 'headline-only')), created_at TEXT NOT NULL, PRIMARY KEY (run_id, source_url), FOREIGN KEY (run_id) REFERENCES briefing_runs(id))`,
      );
      this.ctx.storage.sql.exec(
        `INSERT INTO schema_migrations (version, applied_at) VALUES (5, datetime('now'))`,
      );
    });
  }
}

/** Produces a bounded local diagnostic without persisting a model response. */
function proposalDiagnostic(caught: unknown, response: unknown): string {
  const error = caught instanceof Error ? caught.message : 'Unknown error';
  const output =
    typeof response === 'object' &&
    response !== null &&
    'response' in response &&
    typeof response.response === 'string'
      ? ` Model response: ${response.response.slice(0, 1_000)}`
      : '';

  return `${error}${output}`.slice(0, 1_500);
}
