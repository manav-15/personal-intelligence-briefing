import {
  briefingDiagnosticsSchema,
  type BriefingDiagnostics,
} from '../shared/briefing-diagnostics';
import { AIChatAgent } from '@cloudflare/ai-chat';
import {
  preferencesSchema,
  topicProposalSchema,
  topicProposalRequestSchema,
  type Preferences,
} from '../shared/preferences';
import {
  briefingArchiveEntrySchema,
  briefingRunInputSchema,
  briefingRunStatusResponseSchema,
  briefingSchema,
  type Briefing,
  type BriefingArchiveEntry,
  type BriefingRunStatusResponse,
} from '../shared/briefings';
import {
  briefingCollectionResultSchema,
  briefingCollectionSnapshotSchema,
  defaultBriefingCollectionBudget,
  type BriefingCollectionResult,
  type BriefingCollectionSnapshot,
} from './briefing-collection';
import {
  buildBriefingCompositionInput,
  composeBriefing,
  type BriefingCompositionResult,
  type BriefingPriorItem,
} from './briefing-composition';
import {
  buildTopicProposalInput,
  parseTopicProposalResponse,
  topicProposalModel,
  type StoredTopicProposal,
} from './topic-proposals';
import {
  briefingChatModel,
  buildBriefingChatContext,
  buildChatMessages,
  parseChatModelResponse,
  parseChatRequest,
} from './chat-context';
import {
  briefingEvidenceSchema,
  chatMessageSchema,
  chatSessionMessagesSchema,
  chatSessionSchema,
  type BriefingEvidence,
  type ChatMessage,
  type ChatSession,
} from '../shared/chat';
import { evidenceSchema, storyCandidateSchema } from '../shared/inspection';
import { z } from 'zod';

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

/** Outcome of recording an idempotent manual briefing run snapshot. */
export type BriefingRunStartResult =
  { ok: true; created: boolean } | { ok: false; error: string };

/** Outcome of atomically reserving one manual briefing run for a user. */
export type ManualBriefingRunResult =
  | { ok: true; runId: string; date: string; created: boolean }
  | { ok: false; error: string };

/** Outcome of atomically publishing an already composed briefing. */
export type BriefingPublishResult =
  | { ok: true; briefing: Briefing; idempotent: boolean }
  | { ok: false; error: string };

/** Stable owner key supplied at the Worker edge; Access `sub` will replace the local placeholder. */
export type UserId = string;

/** Retained article text per cited source, matching the extraction ceiling. */
const maxRetainedEvidenceCharacters = 12_000;

/** Singleton durable owner of briefing preferences, generation, and grounded chat. */
export class PersonalBriefingAgent extends AIChatAgent<PreferencesAgentEnv> {
  /** Retains a bounded personal transcript while Agent-managed SQLite handles stream recovery. */
  maxPersistedMessages = 40;

  /** Responds to one story-grounded chat turn while the Agent persists its transcript. */
  async onChatMessage(
    _onFinish: Parameters<AIChatAgent['onChatMessage']>[0],
    options?: Parameters<AIChatAgent['onChatMessage']>[1],
  ): Promise<Response> {
    const request = parseChatRequest(options?.body);

    if (request === null)
      return new Response(
        'Choose a saved conversation before asking a follow-up.',
      );

    const session = this.readChatSession(request.sessionId, 'single-user');

    if (session === undefined)
      return new Response(
        'That saved conversation is unavailable. Choose another story and try again.',
      );

    const question = latestChatQuestion(this.messages);

    if (question === null)
      return new Response('Your question was not available. Please try again.');

    this.appendChatMessage(session.id, question, 'single-user');
    const context = buildBriefingChatContext(
      this.readBriefingByRun(session.briefingRunId, 'single-user'),
      session.storyId,
      this.readBriefingEvidence(
        session.briefingRunId,
        session.storyId,
        'single-user',
      ),
    );

    if (context === null)
      return new Response(
        'The story linked to this conversation is no longer available. Choose another story and try again.',
      );

    if (this.env.AI === undefined)
      return new Response('Workers AI is not configured for this Worker.', {
        status: 503,
      });

    const response = await this.env.AI.run(briefingChatModel, {
      max_tokens: 650,
      messages: buildChatMessages(
        context,
        this.readChatMessages(session.id, 'single-user', 12),
      ),
      temperature: 0,
    });
    const answer = parseChatModelResponse(response);
    const content =
      answer ??
      'I could not produce a grounded answer from the selected briefing story. Please try again.';

    this.appendChatMessage(
      session.id,
      { id: crypto.randomUUID(), role: 'assistant', content },
      'single-user',
    );

    return new Response(content);
  }

  /** Creates a durable conversation after verifying that its cited story belongs to the user. */
  createChatSession(
    briefingRunId: string,
    storyId: string,
    userId: UserId,
  ): ChatSession | undefined {
    this.ensureSchema();
    const briefing = this.readBriefingByRun(briefingRunId, userId);
    const story = briefing?.items.find((item) => item.id === storyId);

    if (briefing === undefined || story === undefined) return undefined;

    const session = chatSessionSchema.parse({
      id: crypto.randomUUID(),
      briefingRunId,
      briefingDate: briefing.date,
      storyId,
      storyHeadline: story.headline,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    this.ctx.storage.sql.exec(
      `INSERT INTO chat_sessions (id, user_id, briefing_run_id, briefing_date, story_id, story_headline, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      session.id,
      userId,
      session.briefingRunId,
      session.briefingDate,
      session.storyId,
      session.storyHeadline,
      session.createdAt,
      session.updatedAt,
    );

    return session;
  }

  /** Lists retained conversations across current and historically archived briefing editions. */
  listChatSessions(userId: UserId): ChatSession[] {
    this.ensureSchema();

    return [
      ...this.ctx.storage.sql.exec<ChatSession>(
        `SELECT id, briefing_run_id AS briefingRunId, briefing_date AS briefingDate, story_id AS storyId, story_headline AS storyHeadline, created_at AS createdAt, updated_at AS updatedAt FROM chat_sessions WHERE user_id = ? ORDER BY updated_at DESC LIMIT 200`,
        userId,
      ),
    ].map((row) => chatSessionSchema.parse(row));
  }

  /** Reads durable messages for one owner-scoped conversation, without exposing another user's history. */
  readChatSessionMessages(
    sessionId: string,
    userId: UserId,
  ): z.infer<typeof chatSessionMessagesSchema> | undefined {
    const session = this.readChatSession(sessionId, userId);

    if (session === undefined) return undefined;

    return chatSessionMessagesSchema.parse({
      session,
      messages: this.readChatMessages(sessionId, userId),
    });
  }

  /** Deletes one owner-scoped conversation and every durable turn it contains. */
  deleteChatSession(sessionId: string, userId: UserId): boolean {
    this.ensureSchema();

    return this.ctx.storage.transactionSync(() => {
      const exists = [
        ...this.ctx.storage.sql.exec<{ id: string }>(
          `SELECT id FROM chat_sessions WHERE id = ? AND user_id = ?`,
          sessionId,
          userId,
        ),
      ][0];

      if (exists === undefined) return false;

      this.ctx.storage.sql.exec(
        `DELETE FROM chat_messages WHERE session_id = ?`,
        sessionId,
      );
      this.ctx.storage.sql.exec(
        `DELETE FROM chat_sessions WHERE id = ? AND user_id = ?`,
        sessionId,
        userId,
      );

      return true;
    });
  }

  /** Reserves one active manual run using the saved timezone and current preferences. */
  reserveManualBriefingRun(
    userId: UserId,
    now = new Date(),
  ): ManualBriefingRunResult {
    this.ensureSchema();
    const stored = this.readStoredPreferences(userId);

    if (!stored.configured)
      return {
        ok: false,
        error: 'Save preferences before starting a briefing.',
      };

    if (!stored.preferences.topics.some((topic) => topic.enabled))
      return {
        ok: false,
        error: 'Enable at least one topic before generating a briefing.',
      };
    this.expireBriefingRuns(userId, now);
    const date = localDate(now, stored.preferences.global.schedule.timezone);

    return this.ctx.storage.transactionSync(() => {
      const active = [
        ...this.ctx.storage.sql.exec<{ id: string }>(
          `SELECT id FROM briefing_runs WHERE user_id = ? AND status = 'running' ORDER BY created_at ASC LIMIT 1`,
          userId,
        ),
      ][0];

      if (active !== undefined)
        return { ok: true, runId: active.id, date, created: false };
      const runId = crypto.randomUUID();
      const snapshot = briefingCollectionSnapshotSchema.parse({
        runId,
        preferenceRevision: stored.preferences.revision,
        preferences: stored.preferences,
        budget: defaultBriefingCollectionBudget,
      });

      this.ctx.storage.sql.exec(
        `INSERT INTO briefing_runs (id, user_id, preference_revision, status, collection_snapshot, created_at) VALUES (?, ?, ?, 'running', ?, datetime('now'))`,
        runId,
        userId,
        stored.preferences.revision,
        JSON.stringify(snapshot),
      );

      return { ok: true, runId, date, created: true };
    });
  }
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
        `UPDATE briefing_runs SET collection_failures = ?, collection_diagnostics = ? WHERE id = ?`,
        JSON.stringify(collection.failures),
        collection.diagnostics === undefined
          ? null
          : JSON.stringify(collection.diagnostics),
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

  /** Reads retained metadata without restoring temporary article text or exposing another owner's run. */
  readBriefingDiagnostics(
    runId: string,
    userId: UserId,
  ): BriefingDiagnostics | null | undefined {
    this.ensureSchema();
    briefingRunInputSchema.shape.runId.parse(runId);
    const row = [
      ...this.ctx.storage.sql.exec<{ collection_diagnostics: string | null }>(
        `SELECT collection_diagnostics FROM briefing_runs WHERE id = ? AND user_id = ?`,
        runId,
        userId,
      ),
    ][0];

    if (row === undefined) return undefined;

    return row.collection_diagnostics === null
      ? null
      : briefingDiagnosticsSchema.parse(
          JSON.parse(row.collection_diagnostics) as unknown,
        );
  }

  /** Composes one grounded in-memory draft from an active run without publishing it. */
  async composeBriefingDraft(
    runId: string,
    userId: UserId,
    date = new Date().toISOString().slice(0, 10),
  ): Promise<BriefingCompositionResult> {
    this.ensureSchema();
    const snapshot = this.readBriefingCollectionSnapshot(runId, userId);
    const collection = this.readBriefingCollection(runId, userId);

    if (snapshot === undefined || collection === undefined)
      return { ok: false, error: 'Briefing collection is not available.' };

    if (this.env.AI === undefined)
      return {
        ok: false,
        error: 'Workers AI is not configured for this Worker.',
      };

    const priorCoverage = this.readRecentBriefingCoverage(userId, date);
    const input = buildBriefingCompositionInput(
      snapshot,
      collection,
      priorCoverage,
      date,
    );

    return composeBriefing(input, this.env.AI);
  }

  /** Reads compact published items from the preceding seven days for update comparison. */
  readRecentBriefingCoverage(
    userId: UserId,
    date: string,
  ): BriefingPriorItem[] {
    this.ensureSchema();
    const day = Date.parse(`${date}T00:00:00.000Z`);

    if (Number.isNaN(day)) throw new Error('Composition date is invalid.');
    const cutoff = new Date(day - 6 * 86_400_000).toISOString();
    const rows = [
      ...this.ctx.storage.sql.exec<{ document: string }>(
        `SELECT document FROM briefings WHERE user_id = ? AND published_at >= ? ORDER BY published_at DESC LIMIT 50`,
        userId,
        cutoff,
      ),
    ];

    return rows.flatMap((row) => {
      const briefing = briefingSchema.parse(
        JSON.parse(row.document) as unknown,
      );

      return briefing.items.map((item) => ({
        runId: briefing.runId,
        itemId: item.id,
        topicIds: item.topicIds,
        headline: item.headline,
        summary: item.summary,
        publishedAt: item.publishedAt,
      }));
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
      this.retainBriefingEvidence(briefing, userId);
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

  /**
   * Copies bounded extracted text for every cited source before the run's
   * temporary evidence is deleted, so a later follow-up can consult the article
   * that supported a published item. Runs inside the publication transaction.
   */
  private retainBriefingEvidence(briefing: Briefing, userId: UserId): void {
    const candidates = [
      ...this.ctx.storage.sql.exec<{
        source_url: string;
        story: string;
        evidence: string;
        retrieved_at: string;
      }>(
        `SELECT candidate.source_url, candidate.story, candidate.evidence, strftime('%Y-%m-%dT%H:%M:%SZ', candidate.created_at) AS retrieved_at FROM briefing_candidates AS candidate INNER JOIN briefing_runs AS run ON run.id = candidate.run_id WHERE candidate.run_id = ? AND run.user_id = ?`,
        briefing.runId,
        userId,
      ),
    ].map((row) => ({
      sourceUrl: row.source_url,
      retrievedAt: row.retrieved_at,
      story: storyCandidateSchema.safeParse(JSON.parse(row.story) as unknown),
      evidence: evidenceSchema.safeParse(JSON.parse(row.evidence) as unknown),
    }));

    for (const item of briefing.items) {
      for (const citation of item.citations) {
        const candidate = candidates.find(
          (entry) => entry.sourceUrl === citation.sourceUrl,
        );
        const retained = candidate === undefined ? null : retainable(candidate);

        if (candidate === undefined || retained === null) continue;

        const text = retained.text.slice(0, maxRetainedEvidenceCharacters);

        this.ctx.storage.sql.exec(
          `INSERT OR REPLACE INTO briefing_evidence (run_id, item_id, source_url, publisher, evidence_tier, retrieved_at, characters, truncated, text) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          briefing.runId,
          item.id,
          citation.sourceUrl,
          citation.publisher,
          citation.evidenceTier,
          candidate.retrievedAt,
          text.length,
          retained.truncated || text.length < retained.text.length ? 1 : 0,
          text,
        );
      }
    }
  }

  /** Reads retained evidence for one published item; older briefings hold none. */
  readBriefingEvidence(
    runId: string,
    itemId: string,
    userId: UserId,
  ): BriefingEvidence[] {
    this.ensureSchema();
    briefingRunInputSchema.shape.runId.parse(runId);
    const rows = [
      ...this.ctx.storage.sql.exec<{
        source_url: string;
        publisher: string | null;
        evidence_tier: 'article' | 'description' | 'headline-only';
        retrieved_at: string;
        characters: number;
        truncated: number;
        text: string;
      }>(
        `SELECT evidence.source_url, evidence.publisher, evidence.evidence_tier, evidence.retrieved_at, evidence.characters, evidence.truncated, evidence.text FROM briefing_evidence AS evidence INNER JOIN briefings AS briefing ON briefing.run_id = evidence.run_id WHERE evidence.run_id = ? AND evidence.item_id = ? AND briefing.user_id = ? ORDER BY evidence.source_url ASC`,
        runId,
        itemId,
        userId,
      ),
    ];

    return rows.map((row) =>
      briefingEvidenceSchema.parse({
        sourceUrl: row.source_url,
        publisher: row.publisher,
        evidenceTier: row.evidence_tier,
        retrievedAt: row.retrieved_at,
        characters: row.characters,
        truncated: row.truncated === 1,
        text: row.text,
      }),
    );
  }

  /** Marks an active run failed, retains its reason, and removes temporary evidence. */
  failBriefingRun(
    runId: string,
    userId: UserId,
    failureMessage = 'The briefing could not be completed.',
  ): boolean {
    this.ensureSchema();
    const parsedMessage =
      briefingRunStatusResponseSchema.shape.failureMessage.safeParse(
        failureMessage,
      );
    const message = parsedMessage.success
      ? parsedMessage.data
      : 'The briefing could not be completed.';

    return this.ctx.storage.transactionSync(() => {
      const result = this.ctx.storage.sql.exec(
        `UPDATE briefing_runs SET status = 'failed', failure_message = ? WHERE id = ? AND user_id = ? AND status = 'running'`,
        message,
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

  /** Returns the briefing whose date is current in the saved preference timezone. */
  readTodayBriefing(userId: UserId, now = new Date()): Briefing | undefined {
    this.ensureSchema();
    const preferences = this.readStoredPreferences(userId);

    if (!preferences.configured) return undefined;

    return this.readBriefingForDate(
      userId,
      localDate(now, preferences.preferences.global.schedule.timezone),
    );
  }

  /** Closes abandoned reservations after the bounded workflow execution window. */
  expireBriefingRuns(userId: UserId, now = new Date()): void {
    this.ensureSchema();
    const cutoff = new Date(now.getTime() - 30 * 60_000).toISOString();
    const rows = [
      ...this.ctx.storage.sql.exec<{ id: string }>(
        `SELECT id FROM briefing_runs WHERE user_id = ? AND status = 'running' AND julianday(created_at) < julianday(?)`,
        userId,
        cutoff,
      ),
    ];

    for (const row of rows)
      this.failBriefingRun(
        row.id,
        userId,
        'Generation timed out. Your previous briefings are safe; you can try again.',
      );
  }

  /** Reads the latest run so navigation and new tabs can recover generation state. */
  readLatestBriefingRun(userId: UserId): BriefingRunStatusResponse | undefined {
    this.ensureSchema();
    this.expireBriefingRuns(userId);
    const row = [
      ...this.ctx.storage.sql.exec<{ id: string }>(
        `SELECT id FROM briefing_runs WHERE user_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1`,
        userId,
      ),
    ][0];

    return row === undefined
      ? undefined
      : this.readBriefingRunStatus(row.id, userId);
  }

  /** Reads a user's run state and persisted collection failures for client polling. */
  readBriefingRunStatus(
    runId: string,
    userId: UserId,
  ): BriefingRunStatusResponse | undefined {
    this.ensureSchema();
    briefingRunInputSchema.shape.runId.parse(runId);
    const row = [
      ...this.ctx.storage.sql.exec<{
        status: 'running' | 'published' | 'failed';
        failure_message: string | null;
        collection_failures: string | null;
      }>(
        `SELECT status, failure_message, collection_failures FROM briefing_runs WHERE id = ? AND user_id = ?`,
        runId,
        userId,
      ),
    ][0];

    if (row === undefined) return undefined;

    return briefingRunStatusResponseSchema.parse({
      runId,
      status: row.status,
      failureMessage: row.failure_message,
      collectionFailures:
        row.collection_failures === null
          ? []
          : (JSON.parse(row.collection_failures) as unknown),
    });
  }

  /** Returns one exact dated briefing without falling back to an earlier publication. */
  readBriefingForDate(userId: UserId, date: string): Briefing | undefined {
    this.ensureSchema();
    const row = [
      ...this.ctx.storage.sql.exec<{ document: string }>(
        `SELECT document FROM briefings WHERE user_id = ? AND date = ? ORDER BY published_at DESC LIMIT 1`,
        userId,
        date,
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

  /** Reads one immutable publication scoped to its owner. */
  readBriefingByRun(runId: string, userId: UserId): Briefing | undefined {
    this.ensureSchema();
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

  /** Reads a single durable session after confirming it belongs to the supplied user. */
  private readChatSession(
    sessionId: string,
    userId: UserId,
  ): ChatSession | undefined {
    this.ensureSchema();
    const row = [
      ...this.ctx.storage.sql.exec<ChatSession>(
        `SELECT id, briefing_run_id AS briefingRunId, briefing_date AS briefingDate, story_id AS storyId, story_headline AS storyHeadline, created_at AS createdAt, updated_at AS updatedAt FROM chat_sessions WHERE id = ? AND user_id = ?`,
        sessionId,
        userId,
      ),
    ][0];

    return row === undefined ? undefined : chatSessionSchema.parse(row);
  }

  /** Reads the bounded, session-scoped model history in chronological order. */
  private readChatMessages(
    sessionId: string,
    userId: UserId,
    limit = 200,
  ): ChatMessage[] {
    this.ensureSchema();
    const belongsToUser = [
      ...this.ctx.storage.sql.exec<{ id: string }>(
        `SELECT id FROM chat_sessions WHERE id = ? AND user_id = ?`,
        sessionId,
        userId,
      ),
    ][0];

    if (belongsToUser === undefined) return [];

    const maximum = limit === 12 ? 12 : 200;

    return [
      ...this.ctx.storage.sql.exec<ChatMessage>(
        `SELECT id, role, content, created_at AS createdAt FROM chat_messages WHERE session_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ${String(maximum)}`,
        sessionId,
      ),
    ]
      .reverse()
      .map((row) => chatMessageSchema.parse(row));
  }

  /** Appends an idempotent user or Agent turn and advances its session in archive ordering. */
  private appendChatMessage(
    sessionId: string,
    message: Pick<ChatMessage, 'id' | 'role' | 'content'>,
    userId: UserId,
  ): void {
    this.ensureSchema();
    const parsed = chatMessageSchema.parse({
      ...message,
      createdAt: new Date().toISOString(),
    });

    this.ctx.storage.transactionSync(() => {
      const belongsToUser = [
        ...this.ctx.storage.sql.exec<{ id: string }>(
          `SELECT id FROM chat_sessions WHERE id = ? AND user_id = ?`,
          sessionId,
          userId,
        ),
      ][0];

      if (belongsToUser === undefined) return;

      this.ctx.storage.sql.exec(
        `INSERT OR IGNORE INTO chat_messages (id, session_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)`,
        parsed.id,
        sessionId,
        parsed.role,
        parsed.content,
        parsed.createdAt,
      );
      this.ctx.storage.sql.exec(
        `UPDATE chat_sessions SET updated_at = ? WHERE id = ?`,
        parsed.createdAt,
        sessionId,
      );
    });
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

      if (!hasMigration(5)) {
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
      }

      if (!hasMigration(6)) {
        this.ctx.storage.sql.exec(
          `ALTER TABLE briefing_runs ADD COLUMN failure_message TEXT`,
        );
        this.ctx.storage.sql.exec(
          `INSERT INTO schema_migrations (version, applied_at) VALUES (6, datetime('now'))`,
        );
      }

      if (!hasMigration(7)) {
        this.ctx.storage.sql.exec(
          `ALTER TABLE briefing_runs ADD COLUMN collection_diagnostics TEXT`,
        );
        this.ctx.storage.sql.exec(
          `INSERT INTO schema_migrations (version, applied_at) VALUES (7, datetime('now'))`,
        );
      }

      if (!hasMigration(8)) {
        this.ctx.storage.sql.exec(
          `CREATE TABLE chat_sessions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, briefing_run_id TEXT NOT NULL, briefing_date TEXT NOT NULL, story_id TEXT NOT NULL, story_headline TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, FOREIGN KEY (briefing_run_id) REFERENCES briefings(run_id))`,
        );
        this.ctx.storage.sql.exec(
          `CREATE INDEX chat_sessions_latest_by_user ON chat_sessions (user_id, updated_at DESC)`,
        );
        this.ctx.storage.sql.exec(
          `CREATE TABLE chat_messages (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, role TEXT NOT NULL CHECK (role IN ('user', 'assistant')), content TEXT NOT NULL, created_at TEXT NOT NULL, FOREIGN KEY (session_id) REFERENCES chat_sessions(id))`,
        );
        this.ctx.storage.sql.exec(
          `CREATE INDEX chat_messages_by_session ON chat_messages (session_id, created_at ASC)`,
        );
        this.ctx.storage.sql.exec(
          `INSERT INTO schema_migrations (version, applied_at) VALUES (8, datetime('now'))`,
        );
      }

      if (hasMigration(9)) return;
      this.ctx.storage.sql.exec(
        `CREATE TABLE briefing_evidence (run_id TEXT NOT NULL, item_id TEXT NOT NULL, source_url TEXT NOT NULL, publisher TEXT, evidence_tier TEXT NOT NULL, retrieved_at TEXT NOT NULL, characters INTEGER NOT NULL, truncated INTEGER NOT NULL, text TEXT NOT NULL, PRIMARY KEY (run_id, item_id, source_url), FOREIGN KEY (run_id) REFERENCES briefings(run_id))`,
      );
      this.ctx.storage.sql.exec(
        `INSERT INTO schema_migrations (version, applied_at) VALUES (9, datetime('now'))`,
      );
    });
  }
}

/** Extracts the latest bounded user turn supplied by the Agent chat transport. */
function latestChatQuestion(
  value: unknown,
): Pick<ChatMessage, 'id' | 'role' | 'content'> | null {
  const messages = z.array(z.unknown()).safeParse(value);
  const message = z
    .object({
      id: z.string().trim().min(1).max(200),
      role: z.literal('user'),
      parts: z.array(
        z.looseObject({ type: z.literal('text'), text: z.string() }),
      ),
    })
    .safeParse(messages.success ? messages.data.at(-1) : undefined);

  if (!message.success) return null;

  const content = message.data.parts
    .map((part) => part.text)
    .join('\n')
    .trim();

  if (content === '') return null;

  const parsed = chatMessageSchema.safeParse({
    id: message.data.id,
    role: 'user',
    content,
    createdAt: new Date().toISOString(),
  });

  return parsed.success
    ? {
        id: parsed.data.id,
        role: parsed.data.role,
        content: parsed.data.content,
      }
    : null;
}

function localDate(now: Date, timezone: string): string {
  const values = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const year = values.find((part) => part.type === 'year')?.value;
  const month = values.find((part) => part.type === 'month')?.value;
  const day = values.find((part) => part.type === 'day')?.value;

  if (year === undefined || month === undefined || day === undefined)
    throw new Error('Timezone formatting did not return a complete date.');

  return `${year}-${month}-${day}`;
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

/**
 * Chooses the bounded text a follow-up may consult for one cited source: the
 * extracted article body, or the attributed description that supported a
 * description-tier item. Headline-only sources contribute nothing.
 */
function retainable(candidate: {
  story: ReturnType<typeof storyCandidateSchema.safeParse>;
  evidence: ReturnType<typeof evidenceSchema.safeParse>;
}): { text: string; truncated: boolean } | null {
  if (candidate.evidence.success && candidate.evidence.data.status === 'usable')
    return {
      text: candidate.evidence.data.text,
      truncated: candidate.evidence.data.truncated,
    };

  const description = candidate.story.success
    ? candidate.story.data.description?.text
    : undefined;

  return description === undefined || !description.trim()
    ? null
    : { text: description, truncated: false };
}
