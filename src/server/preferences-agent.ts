import { Agent } from 'agents';
import {
  preferencesSchema,
  topicProposalSchema,
  topicProposalRequestSchema,
  type Preferences,
} from '../shared/preferences';
import {
  buildTopicProposalInput,
  parseTopicProposalResponse,
  topicProposalModel,
  type StoredTopicProposal,
} from './topic-proposals';

/** Bindings used by the singleton preferences Agent. */
export type PreferencesAgentEnv = {
  AI?: Ai;
  PERSONAL_BRIEFING: DurableObjectNamespace<PersonalBriefingAgent>;
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

      if (!hasMigration(1)) {
        this.ctx.storage.sql.exec(
          `CREATE TABLE preferences (singleton INTEGER PRIMARY KEY CHECK (singleton = 1), revision INTEGER NOT NULL, document TEXT NOT NULL)`,
        );
        this.ctx.storage.sql.exec(
          `INSERT INTO schema_migrations (version, applied_at) VALUES (1, datetime('now'))`,
        );
      }

      if (!hasMigration(2)) {
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
        this.ctx.storage.sql.exec(
          `INSERT INTO schema_migrations (version, applied_at) VALUES (2, datetime('now'))`,
        );
      }

      if (hasMigration(3)) return;
      this.ctx.storage.sql.exec(
        `CREATE TABLE topic_proposals (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, base_revision INTEGER NOT NULL, proposal TEXT NOT NULL, prompt_version TEXT NOT NULL, status TEXT NOT NULL CHECK (status IN ('pending', 'applied', 'discarded')), created_at TEXT NOT NULL)`,
      );
      this.ctx.storage.sql.exec(
        `CREATE INDEX topic_proposals_pending_by_user ON topic_proposals (user_id, status, created_at)`,
      );
      this.ctx.storage.sql.exec(
        `INSERT INTO schema_migrations (version, applied_at) VALUES (3, datetime('now'))`,
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
