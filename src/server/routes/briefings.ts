import { Hono } from 'hono';
import type { PreferencesAgentEnv } from '../preferences-agent';
import {
  allowMethods,
  diagnosticEnabled,
  noStore,
  sameOrigin,
  type HttpEnv,
} from './policy';

type BriefingsHttpEnv = HttpEnv & {
  Variables: { binding: PreferencesAgentEnv['PERSONAL_BRIEFING'] };
};

const localUserId = 'single-user';

/** Local read-only briefing diagnostics for Today and Archive. */
export const briefingsRoutes = new Hono<BriefingsHttpEnv>();

briefingsRoutes.use('*', noStore);

briefingsRoutes.use(
  '*',
  diagnosticEnabled(
    'PREFERENCES_DIAGNOSTICS_ENABLED',
    'Preference diagnostics are disabled.',
  ),
);

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

  const briefing = await agent.readLatestBriefing(localUserId);

  return c.json({ briefing: briefing ?? null });
});

briefingsRoutes.all('/archive', allowMethods('GET'));

briefingsRoutes.get('/archive', async (c) => {
  const binding = c.get('binding');
  const agent = binding.get(binding.idFromName(localUserId));

  return c.json({ briefings: await agent.listBriefingArchive(localUserId) });
});
