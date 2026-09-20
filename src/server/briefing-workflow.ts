import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from 'cloudflare:workers';
import { collectBriefingCandidates } from './briefing-collection';
import type { BriefingCompositionResult } from './briefing-composition';
import {
  createSearxngContainerFetcher,
  searxngContainerBaseUrl,
  type SearxngContainer,
} from './searxng-container';
import type { PersonalBriefingAgent } from './preferences-agent';

/** Serializable parameters for one manually requested briefing workflow. */
export type BriefingWorkflowParams = {
  runId: string;
  userId: string;
  date: string;
};

/** Bindings used by the durable manual briefing workflow. */
export type BriefingWorkflowEnv = {
  PERSONAL_BRIEFING: DurableObjectNamespace<PersonalBriefingAgent>;
  SEARXNG: DurableObjectNamespace<SearxngContainer>;
  SEARXNG_BASE_URL?: string;
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

    try {
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
            {
              searxng: searxngProvider(this.env),
            },
            new Date(event.timestamp),
          );
          const stored = await agent.storeBriefingCollection(
            runId,
            collection,
            userId,
          );

          if (!stored)
            throw new Error('Briefing collection could not be stored.');

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

      if (!composed.ok) {
        await step.do(
          'fail composition',
          { retries: { limit: 2, delay: '1 second' } },
          () => agent.failBriefingRun(runId, userId, composed.error),
        );

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

          return { published: true };
        },
      );
    } catch {
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

function searxngProvider(env: BriefingWorkflowEnv) {
  if (env.SEARXNG_BASE_URL !== undefined)
    return { baseUrl: env.SEARXNG_BASE_URL, fetcher: fetch };

  return {
    baseUrl: searxngContainerBaseUrl,
    fetcher: createSearxngContainerFetcher(env.SEARXNG),
  };
}
