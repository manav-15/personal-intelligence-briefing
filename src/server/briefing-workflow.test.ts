import { describe, expect, it, vi } from 'vitest';
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
  it('marks a rejected publication failed instead of completing with a running reservation', async () => {
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
      SEARXNG_BASE_URL: 'http://localhost:8080',
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
  });
});
