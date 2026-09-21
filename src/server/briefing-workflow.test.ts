import { describe, expect, it, vi } from 'vitest';
import { collectBriefingCandidates } from './briefing-collection';
import { getContainer } from '@cloudflare/containers';
import {
  BriefingWorkflow,
  type BriefingWorkflowEnv,
  type BriefingWorkflowParams,
} from './briefing-workflow';
import type { WorkflowEvent, WorkflowStep } from 'cloudflare:workers';

vi.mock('./briefing-collection', () => ({
  collectBriefingCandidates: vi
    .fn()
    .mockResolvedValue({ candidates: [], failures: [] }),
}));

const runId = 'ad7fb1a7-9d5d-4cbe-a571-c8e3a0d0f0ee';

describe('briefing workflow terminal states', () => {
  it.each(['local', 'container'] as const)(
    'uses %s SearXNG and closes a rejected publication reservation',
    async (mode) => {
      const containerFetch = vi
        .fn()
        .mockResolvedValue(Response.json({ results: [] }));

      vi.mocked(getContainer).mockReturnValue({
        fetch: containerFetch,
      } as never);
      const agent = {
        readBriefingCollectionSnapshot: vi.fn().mockResolvedValue({ runId }),
        storeBriefingCollection: vi.fn().mockResolvedValue(true),
        composeBriefingDraft: vi
          .fn()
          .mockResolvedValue({ ok: true, briefing: { runId } }),
        publishBriefing: vi
          .fn()
          .mockResolvedValue({ ok: false, error: 'Snapshot mismatch' }),
        failBriefingRun: vi.fn().mockResolvedValue(true),
      };
      const env = {
        PERSONAL_BRIEFING: { idFromName: () => runId, get: () => agent },
        ...(mode === 'local'
          ? { SEARXNG_BASE_URL: 'http://localhost:8080' }
          : { SEARXNG: {} }),
      } as unknown as BriefingWorkflowEnv;
      const workflow = new BriefingWorkflow({} as ExecutionContext, env);
      const step = {
        do: (
          _name: string,
          _options: unknown,
          callback: () => Promise<unknown>,
        ) => callback(),
      } as unknown as WorkflowStep;
      const event = {
        payload: { runId, userId: 'test-user', date: '2026-09-19' },
        timestamp: new Date('2026-09-19T08:00:00Z'),
      } as WorkflowEvent<BriefingWorkflowParams>;

      await expect(workflow.run(event, step)).resolves.toMatchObject({
        status: 'failed',
      });
      expect(agent.failBriefingRun).toHaveBeenCalledWith(
        runId,
        'test-user',
        'The briefing run failed unexpectedly.',
      );
      expect(agent.composeBriefingDraft).toHaveBeenCalledTimes(1);
      const providers = vi
        .mocked(collectBriefingCandidates)
        .mock.calls.at(-1)?.[2];

      expect(providers?.searxng?.baseUrl).toBe(
        mode === 'local' ? 'http://localhost:8080' : 'http://searxng.internal',
      );

      if (mode === 'container') {
        await providers?.searxng?.fetcher(
          'http://searxng.internal/search?q=AI',
        );
        expect(containerFetch).toHaveBeenCalledWith(expect.any(Request));
      }
    },
  );
});
