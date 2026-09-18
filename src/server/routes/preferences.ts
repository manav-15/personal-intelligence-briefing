import { Hono } from 'hono';
import { z } from 'zod';
import type { PreferencesAgentEnv } from '../preferences-agent';
import { preferencesSchema } from '../../shared/preferences';
import {
  allowMethods,
  diagnosticEnabled,
  noStore,
  sameOrigin,
  type HttpEnv,
} from './policy';

type PreferencesHttpEnv = HttpEnv & {
  Variables: { binding: PreferencesAgentEnv['PERSONAL_BRIEFING'] };
};

const localUserId = 'single-user';
const envelopeSchema = z.object({
  document: z.unknown().optional(),
  expectedRevision: z.unknown().optional(),
});
const revisionSchema = z.number().refine(Number.isInteger);

/** Local preference diagnostics backed by validated Agent RPC methods. */
export const preferencesRoutes = new Hono<PreferencesHttpEnv>();
preferencesRoutes.use(
  '/',
  diagnosticEnabled(
    'PREFERENCES_DIAGNOSTICS_ENABLED',
    'Preference diagnostics are disabled.',
  ),
);
preferencesRoutes.use('/', async (c, next) => {
  if (c.env.PERSONAL_BRIEFING === undefined)
    return c.json({ error: 'Personal Briefing Agent is not configured.' }, 503);
  c.set('binding', c.env.PERSONAL_BRIEFING);
  await next();
});
preferencesRoutes.use(
  '/',
  sameOrigin('Cross-origin preference access is not allowed.'),
);
preferencesRoutes.all('/', allowMethods('GET', 'PUT'));
preferencesRoutes.get('/', noStore, async (c) => {
  const binding = c.get('binding');
  const agent = binding.get(binding.idFromName(localUserId));

  return c.json(await agent.readPreferences(localUserId));
});
preferencesRoutes.put('/', async (c) => {
  if (
    c.req.header('origin') !== new URL(c.req.url).origin ||
    !c.req.header('content-type')?.includes('application/json')
  ) {
    return c.json({ error: 'A same-origin JSON request is required.' }, 403);
  }

  try {
    const input = envelopeSchema.parse(await c.req.json<unknown>());
    const revision = revisionSchema.safeParse(input.expectedRevision);

    if (!revision.success)
      return c.json({ error: 'expectedRevision must be an integer.' }, 400);
    const document = preferencesSchema.parse(input.document);
    const binding = c.get('binding');
    const agent = binding.get(binding.idFromName(localUserId));
    const result = await agent.replacePreferences(
      document,
      revision.data,
      localUserId,
    );

    if (!result.ok)
      return c.json(
        {
          error: 'Preferences changed before this update could be applied.',
          currentRevision: result.currentRevision,
        },
        409,
      );
    c.header('Cache-Control', 'no-store');

    return c.json({ preferences: result.preferences });
  } catch {
    return c.json({ error: 'Invalid preference document.' }, 400);
  }
});
