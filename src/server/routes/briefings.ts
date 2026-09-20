import { briefingDiagnosticsResponseSchema } from '../../shared/briefing-diagnostics';
import { Hono } from 'hono';
import { briefingRunStatusResponseSchema } from '../../shared/briefings';
import type { PreferencesAgentEnv } from '../preferences-agent';
import {
  diagnosticEnabled,
  allowMethods,
  noStore,
  sameOrigin,
  type HttpEnv,
} from './policy';

type BriefingsHttpEnv = HttpEnv & {
  Variables: { binding: PreferencesAgentEnv['PERSONAL_BRIEFING'] };
};

const localUserId = 'single-user';

/** Authenticated briefing reads, generation, and run-status polling. */
export const briefingsRoutes = new Hono<BriefingsHttpEnv>();

briefingsRoutes.use('*', noStore);

briefingsRoutes.use('*', async (c, next) => {
  if (c.env.PERSONAL_BRIEFING === undefined)
    return c.json({ error: 'Personal Briefing Agent is not configured.' }, 503);
  c.set('binding', c.env.PERSONAL_BRIEFING);
  await next();
});

briefingsRoutes.use(
  '*',
  sameOrigin('Cross-origin briefing access is not allowed.'),
);

briefingsRoutes.all('/today', allowMethods('GET'));

briefingsRoutes.get('/today', async (c) => {
  const binding = c.get('binding');
  const agent = binding.get(binding.idFromName(localUserId));

  const briefing = await agent.readTodayBriefing(localUserId);

  return c.json({ briefing: briefing ?? null });
});

briefingsRoutes.all('/archive', allowMethods('GET'));

briefingsRoutes.get('/archive', async (c) => {
  const binding = c.get('binding');
  const agent = binding.get(binding.idFromName(localUserId));

  return c.json({ briefings: await agent.listBriefingArchive(localUserId) });
});

briefingsRoutes.all('/generate', allowMethods('POST'));

briefingsRoutes.post('/generate', async (c) => {
  if (c.env.BRIEFING_WORKFLOW === undefined)
    return c.json({ error: 'Briefing Workflow is not configured.' }, 503);
  const binding = c.get('binding');
  const agent = binding.get(binding.idFromName(localUserId));
  const reserved = await agent.reserveManualBriefingRun(localUserId);

  if (!reserved.ok) return c.json({ error: reserved.error }, 409);

  if (reserved.created) {
    try {
      await c.env.BRIEFING_WORKFLOW.create({
        id: reserved.runId,
        params: {
          runId: reserved.runId,
          userId: localUserId,
          date: reserved.date,
        },
      });
    } catch {
      await agent.failBriefingRun(
        reserved.runId,
        localUserId,
        'The briefing workflow could not be started.',
      );

      return c.json({ error: 'Briefing Workflow could not be started.' }, 503);
    }
  }

  return c.json({ runId: reserved.runId, created: reserved.created }, 202);
});

briefingsRoutes.all('/runs/:runId', allowMethods('GET'));

briefingsRoutes.get('/runs/:runId', async (c) => {
  const runId = briefingRunStatusResponseSchema.shape.runId.safeParse(
    c.req.param('runId'),
  );

  if (!runId.success) return c.json({ error: 'Invalid briefing run ID.' }, 400);
  const binding = c.get('binding');
  const agent = binding.get(binding.idFromName(localUserId));

  await agent.expireBriefingRuns(localUserId);
  await reconcileWorkflow(c.env.BRIEFING_WORKFLOW, agent, runId.data);
  const status = await agent.readBriefingRunStatus(runId.data, localUserId);

  if (status === undefined)
    return c.json({ error: 'Briefing run not found.' }, 404);

  return c.json(status);
});

briefingsRoutes.all('/current-run', allowMethods('GET'));
briefingsRoutes.get('/current-run', async (c) => {
  const binding = c.get('binding');
  const agent = binding.get(binding.idFromName(localUserId));
  const latest = await agent.readLatestBriefingRun(localUserId);

  if (latest?.status === 'running')
    await reconcileWorkflow(c.env.BRIEFING_WORKFLOW, agent, latest.runId);
  const run =
    latest === undefined
      ? undefined
      : await agent.readBriefingRunStatus(latest.runId, localUserId);

  return c.json({ run: run ?? null });
});

briefingsRoutes.all('/archive/:runId', allowMethods('GET'));
briefingsRoutes.get('/archive/:runId', async (c) => {
  const runId = briefingRunStatusResponseSchema.shape.runId.safeParse(
    c.req.param('runId'),
  );

  if (!runId.success) return c.json({ error: 'Invalid briefing ID.' }, 400);
  const binding = c.get('binding');
  const agent = binding.get(binding.idFromName(localUserId));
  const briefing = await agent.readBriefingByRun(runId.data, localUserId);

  if (briefing === undefined)
    return c.json({ error: 'Briefing not found.' }, 404);

  return c.json({ briefing });
});

async function reconcileWorkflow(
  workflow: HttpEnv['Bindings']['BRIEFING_WORKFLOW'],
  agent: ReturnType<PreferencesAgentEnv['PERSONAL_BRIEFING']['get']>,
  runId: string,
) {
  if (workflow === undefined) return;

  try {
    const instance = await workflow.get(runId);
    const status = await instance.status();

    if (['errored', 'terminated', 'complete'].includes(status.status)) {
      await agent.failBriefingRun(
        runId,
        localUserId,
        'Generation stopped before publication. Your previous editions are safe; please try again.',
      );
    }
  } catch {
    // A transient control-plane failure is not proof the workflow stopped.
  }
}

briefingsRoutes.use(
  '/runs/:runId/diagnostics',
  diagnosticEnabled(
    'PREFERENCES_DIAGNOSTICS_ENABLED',
    'Briefing diagnostics are disabled.',
  ),
);
briefingsRoutes.all('/runs/:runId/diagnostics', allowMethods('GET'));
briefingsRoutes.get('/runs/:runId/diagnostics', async (c) => {
  const runId = briefingRunStatusResponseSchema.shape.runId.safeParse(
    c.req.param('runId'),
  );

  if (!runId.success) return c.json({ error: 'Invalid briefing run ID.' }, 400);
  const binding = c.get('binding');
  const agent = binding.get(binding.idFromName(localUserId));
  const diagnostics = await agent.readBriefingDiagnostics(
    runId.data,
    localUserId,
  );

  if (diagnostics === undefined)
    return c.json({ error: 'Briefing run not found.' }, 404);
  const briefing = await agent.readBriefingByRun(runId.data, localUserId);

  return c.json(
    briefingDiagnosticsResponseSchema.parse({
      diagnostics,
      publishedSourceUrls:
        briefing === undefined
          ? null
          : [
              ...new Set(
                briefing.items.flatMap((item) =>
                  item.citations.map((citation) => citation.sourceUrl),
                ),
              ),
            ],
    }),
  );
});
