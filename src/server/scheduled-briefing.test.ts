import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  scheduledOwnerId,
  startDueScheduledBriefing,
  type ScheduledBriefingEnv,
} from './scheduled-briefing';

const now = new Date('2026-09-21T02:30:00Z');

afterEach(() => {
  vi.restoreAllMocks();
});

describe('scheduled briefing tick', () => {
  it('skips without a binding instead of reaching for HTTP identity', async () => {
    expect(await startDueScheduledBriefing({}, now)).toEqual({
      started: false,
      reason: 'agent-unavailable',
    });

    const withoutWorkflow = {
      PERSONAL_BRIEFING: {},
    } as unknown as ScheduledBriefingEnv;

    expect(await startDueScheduledBriefing(withoutWorkflow, now)).toEqual({
      started: false,
      reason: 'workflow-unavailable',
    });
  });

  it('launches the Workflow for the reserved run and logs the start', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const { env, agent, create } = tickEnv({
      reserve: { created: true, runId: 'run-1', date: '2026-09-21' },
    });

    expect(await startDueScheduledBriefing(env, now)).toEqual({
      started: true,
      runId: 'run-1',
      date: '2026-09-21',
    });
    expect(agent.reserveScheduledBriefingRun).toHaveBeenCalledWith(
      'single-user',
      now,
    );
    expect(create).toHaveBeenCalledWith({
      id: 'run-1',
      params: { runId: 'run-1', userId: 'single-user', date: '2026-09-21' },
    });
    expect(agent.failBriefingRun).not.toHaveBeenCalled();
    expect(log.mock.calls.flat().join('\n')).toContain('briefing.scheduled');
  });

  it('returns the reservation reason without launching or logging a skip', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { env, create } = tickEnv({
      reserve: { created: false, reason: 'already-published' },
    });

    expect(await startDueScheduledBriefing(env, now)).toEqual({
      started: false,
      reason: 'already-published',
    });
    expect(create).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it('closes the reservation when the Workflow cannot be created', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { env, agent } = tickEnv({
      reserve: { created: true, runId: 'run-2', date: '2026-09-21' },
      create: () => Promise.reject(new Error('workflow unavailable')),
    });

    expect(await startDueScheduledBriefing(env, now)).toEqual({
      started: false,
      reason: 'workflow-start-failed',
    });
    expect(agent.failBriefingRun).toHaveBeenCalledWith(
      'run-2',
      'single-user',
      'The briefing workflow could not be started.',
    );
    expect(warn.mock.calls.flat().join('\n')).toContain('briefing.failed');
  });

  it('addresses the same owner id HTTP routes use', async () => {
    const { env, idFromName } = tickEnv({
      reserve: { created: false, reason: 'not-due' },
      primaryUserId: 'owner-1',
    });

    await startDueScheduledBriefing(env, now);
    expect(idFromName).toHaveBeenCalledWith('owner-1');
    expect(scheduledOwnerId({ PRIMARY_USER_ID: '  ' })).toBe('single-user');
    expect(scheduledOwnerId({ PRIMARY_USER_ID: ' owner-1 ' })).toBe('owner-1');
  });
});

function tickEnv(options: {
  reserve: unknown;
  create?: () => Promise<unknown>;
  primaryUserId?: string;
}) {
  const agent = {
    reserveScheduledBriefingRun: vi.fn(() => Promise.resolve(options.reserve)),
    failBriefingRun: vi.fn(() => Promise.resolve(undefined)),
  };
  const idFromName = vi.fn((name: string) => name);
  const create = vi.fn(options.create ?? (() => Promise.resolve({})));
  const env = {
    PRIMARY_USER_ID: options.primaryUserId,
    PERSONAL_BRIEFING: { idFromName, get: () => agent },
    BRIEFING_WORKFLOW: { create },
  } as unknown as ScheduledBriefingEnv;

  return { env, agent, create, idFromName };
}
