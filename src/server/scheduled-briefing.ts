import { boundedMessage, logEvent } from './log';
import type { BriefingWorkflowParams } from './briefing-workflow';
import type { PersonalBriefingAgent } from './preferences-agent';

/** Why a scheduled tick did not launch a new Workflow. */
export type ScheduledBriefingSkipReason =
  | 'not-configured'
  | 'no-topics'
  | 'not-due'
  | 'already-published'
  | 'already-running'
  | 'agent-unavailable'
  | 'workflow-unavailable'
  | 'workflow-start-failed';

/** Outcome of one cron tick. Skips are silent in logs; starts are not. */
export type ScheduledBriefingStartResult =
  | { started: false; reason: ScheduledBriefingSkipReason }
  | { started: true; runId: string; date: string };

/** Bindings the daily trigger needs. HTTP identity is not among them. */
export type ScheduledBriefingEnv = {
  PRIMARY_USER_ID?: string;
  PERSONAL_BRIEFING?: DurableObjectNamespace<PersonalBriefingAgent>;
  BRIEFING_WORKFLOW?: Workflow<BriefingWorkflowParams>;
};

/**
 * Reserves and launches one due daily briefing without going through HTTP.
 *
 * Access never sees this path. The owner is the same stable id HTTP routes use.
 * A tick that is early, already published, or already running is a no-op.
 */
export async function startDueScheduledBriefing(
  env: ScheduledBriefingEnv,
  now: Date,
): Promise<ScheduledBriefingStartResult> {
  if (env.PERSONAL_BRIEFING === undefined)
    return { started: false, reason: 'agent-unavailable' };

  if (env.BRIEFING_WORKFLOW === undefined)
    return { started: false, reason: 'workflow-unavailable' };

  const userId = scheduledOwnerId(env);
  const agent = env.PERSONAL_BRIEFING.get(
    env.PERSONAL_BRIEFING.idFromName(userId),
  );
  const reserved = await agent.reserveScheduledBriefingRun(userId, now);

  if (!reserved.created) return { started: false, reason: reserved.reason };

  try {
    await env.BRIEFING_WORKFLOW.create({
      id: reserved.runId,
      params: {
        runId: reserved.runId,
        userId,
        date: reserved.date,
      },
    });
  } catch (error) {
    await agent.failBriefingRun(
      reserved.runId,
      userId,
      'The briefing workflow could not be started.',
    );
    logEvent(
      'briefing.failed',
      {
        runId: reserved.runId,
        stage: 'schedule',
        reason: boundedMessage(error),
      },
      'warn',
    );

    return { started: false, reason: 'workflow-start-failed' };
  }

  logEvent('briefing.scheduled', {
    runId: reserved.runId,
    date: reserved.date,
  });

  return { started: true, runId: reserved.runId, date: reserved.date };
}

/**
 * Owner used by a scheduled tick. Matches Access when `PRIMARY_USER_ID` is unset.
 */
export function scheduledOwnerId(env: { PRIMARY_USER_ID?: string }): string {
  return env.PRIMARY_USER_ID?.trim() || 'single-user';
}
