import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from 'cloudflare:workers';
import { collectBriefingCandidates } from './briefing-collection';
import type { BriefingCollectionResult } from './briefing-collection';
import type { BriefingCompositionResult } from './briefing-composition';
import { boundedMessage, logEvent } from './log';
import type { PersonalBriefingAgent } from './preferences-agent';
import {
  createSearxngContainerFetcher,
  searxngContainerBaseUrl,
  type SearxngContainer,
} from './searxng-container';

/** Serializable parameters for one manually requested briefing workflow. */
export type BriefingWorkflowParams = {
  runId: string;
  userId: string;
  date: string;
};

/** Local Docker or private production Container bindings for SearXNG discovery. */
export type BriefingWorkflowEnv = {
  PERSONAL_BRIEFING: DurableObjectNamespace<PersonalBriefingAgent>;
  SEARXNG_BASE_URL?: string;
  SEARXNG?: DurableObjectNamespace<SearxngContainer>;
};

/** Collects, composes, and atomically publishes one user-reserved briefing run. */
export class BriefingWorkflow extends WorkflowEntrypoint<
  BriefingWorkflowEnv,
  BriefingWorkflowParams
> {
  /** Executes bounded work and closes the reservation on either terminal path. */
  async run(
    event: Readonly<WorkflowEvent<BriefingWorkflowParams>>,
    step: WorkflowStep,
  ) {
    const { runId, userId, date } = event.payload;
    const binding = this.env.PERSONAL_BRIEFING;
    const agent = binding.get(binding.idFromName(userId));

    logEvent('briefing.started', { runId, userId, date });

    try {
      const collectStartedAt = Date.now();

      await step.do(
        'collect candidates',
        { retries: { limit: 0, delay: '1 second' }, timeout: '10 minutes' },
        async () => {
          const snapshot = await agent.readBriefingCollectionSnapshot(
            runId,
            userId,
          );

          if (snapshot === undefined)
            throw new Error('Briefing run is unavailable.');
          const collection = await collectBriefingCandidates(
            snapshot,
            fetch,
            searchProviders(this.env),
            new Date(event.timestamp),
          );
          const stored = await agent.storeBriefingCollection(
            runId,
            collection,
            userId,
          );

          if (!stored)
            throw new Error('Briefing collection could not be stored.');

          logEvent(
            'briefing.collected',
            collectionLog(runId, collection, collectStartedAt),
          );

          return {
            candidates: collection.candidates.length,
            failures: collection.failures.length,
          };
        },
      );
      const composed = await step.do<BriefingCompositionResult>(
        'compose briefing',
        { retries: { limit: 0, delay: '1 second' }, timeout: '3 minutes' },
        async () =>
          JSON.parse(
            JSON.stringify(
              await agent.composeBriefingDraft(runId, userId, date),
            ),
          ) as BriefingCompositionResult,
      );

      logEvent('briefing.composed', compositionLog(runId, composed));

      if (!composed.ok) {
        await step.do(
          'fail composition',
          { retries: { limit: 2, delay: '1 second' } },
          () => agent.failBriefingRun(runId, userId, composed.error),
        );

        logEvent('briefing.failed', {
          runId,
          stage: 'composition',
          reason: composed.error,
        });

        return { status: 'failed', reason: composed.error };
      }

      return await step.do(
        'publish briefing',
        { retries: { limit: 2, delay: '5 seconds' } },
        async () => {
          const published = await agent.publishBriefing(
            composed.briefing,
            userId,
          );

          if (!published.ok) throw new Error(published.error);

          logEvent('briefing.published', {
            runId,
            items: composed.briefing.items.length,
            completeness: composed.briefing.completeness,
            limitations: [
              ...new Set(
                composed.briefing.limitations.map(
                  (limitation) => limitation.code,
                ),
              ),
            ],
          });

          return { published: true };
        },
      );
    } catch (error) {
      logEvent(
        'briefing.failed',
        { runId, stage: 'unexpected', reason: boundedMessage(error) },
        'warn',
      );
      await step.do(
        'fail briefing',
        { retries: { limit: 2, delay: '1 second' } },
        () =>
          agent.failBriefingRun(
            runId,
            userId,
            'The briefing run failed unexpectedly.',
          ),
      );

      return {
        status: 'failed',
        reason: 'The briefing run failed unexpectedly.',
      };
    }
  }
}

/** Bounded collection summary for Workers Logs; it carries counts, not article text. */
function collectionLog(
  runId: string,
  collection: BriefingCollectionResult,
  startedAt: number,
) {
  const queries = collection.diagnostics?.queries ?? [];
  const diagnostics = collection.diagnostics?.candidates ?? [];
  const outcomes = new Map<string, number>();

  for (const candidate of diagnostics)
    outcomes.set(candidate.outcome, (outcomes.get(candidate.outcome) ?? 0) + 1);

  return {
    runId,
    durationMs: Date.now() - startedAt,
    queries: queries.length,
    failedQueries: queries.filter((query) => query.status === 'failed').length,
    returned: queries.reduce((total, query) => total + query.returned, 0),
    candidates: collection.candidates.length,
    failures: collection.failures.length,
    // Every returned lead, counted by what collection did with it. This is what
    // explains a small candidate set when the providers answered normally.
    outcomes: [...outcomes]
      .sort((left, right) => right[1] - left[1])
      .map(([outcome, count]) => `${outcome}:${String(count)}`),
    failureDetail: collection.failures
      .slice(0, 12)
      .map(
        (failure) =>
          `${failure.stage}:${failure.provider ?? 'unknown'}: ${failure.message}`,
      ),
    queryDetail: queries
      .slice(0, 12)
      .map(
        (query) =>
          `${query.topicId}|${query.status}|${String(query.returned)}|${query.query.slice(0, 60)}`,
      ),
  };
}

/** Bounded composition summary: counts, codes, and a code-owned error message. */
function compositionLog(runId: string, composed: BriefingCompositionResult) {
  if (!composed.ok) return { runId, ok: false, error: composed.error };

  return {
    runId,
    ok: true,
    items: composed.briefing.items.length,
    completeness: composed.briefing.completeness,
    citations: composed.briefing.items.reduce(
      (total, item) => total + item.citations.length,
      0,
    ),
    limitations: [
      ...new Set(
        composed.briefing.limitations.map((limitation) => limitation.code),
      ),
    ],
  };
}

/** Prefers explicit local Docker configuration, otherwise uses the private Container. */
function searchProviders(env: BriefingWorkflowEnv) {
  if (env.SEARXNG_BASE_URL !== undefined)
    return { searxng: { baseUrl: env.SEARXNG_BASE_URL, fetcher: fetch } };

  if (env.SEARXNG !== undefined)
    return {
      searxng: {
        baseUrl: searxngContainerBaseUrl,
        fetcher: createSearxngContainerFetcher(env.SEARXNG),
      },
    };

  return {};
}
