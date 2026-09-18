import { Hono } from 'hono';
import { z } from 'zod';
import type { PreferencesAgentEnv } from '../preferences-agent';
import {
  preferencesSchema,
  topicProposalRequestSchema,
} from '../../shared/preferences';
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
const proposalActionSchema = z.strictObject({
  action: z.enum(['apply', 'discard']),
});
const proposalIdSchema = z.uuid();

/** Local preference diagnostics backed by validated Agent RPC methods. */
export const preferencesRoutes = new Hono<PreferencesHttpEnv>();
preferencesRoutes.use(
  '*',
  diagnosticEnabled(
    'PREFERENCES_DIAGNOSTICS_ENABLED',
    'Preference diagnostics are disabled.',
  ),
);
preferencesRoutes.use('*', async (c, next) => {
  if (c.env.PERSONAL_BRIEFING === undefined)
    return c.json({ error: 'Personal Briefing Agent is not configured.' }, 503);
  c.set('binding', c.env.PERSONAL_BRIEFING);
  await next();
});
preferencesRoutes.use(
  '*',
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
preferencesRoutes.all('/proposals', allowMethods('GET', 'POST'));
preferencesRoutes.get('/proposals', noStore, async (c) => {
  const binding = c.get('binding');
  const agent = binding.get(binding.idFromName(localUserId));

  return c.json({
    proposals: await agent.listPendingTopicProposals(localUserId),
  });
});
preferencesRoutes.post('/proposals', async (c) => {
  if (
    c.req.header('origin') !== new URL(c.req.url).origin ||
    !c.req.header('content-type')?.includes('application/json')
  ) {
    return c.json({ error: 'A same-origin JSON request is required.' }, 403);
  }

  let input;

  try {
    input = topicProposalRequestSchema.parse(await c.req.json<unknown>());
  } catch {
    return c.json({ error: 'Invalid topic proposal request.' }, 400);
  }

  const binding = c.get('binding');
  const agent = binding.get(binding.idFromName(localUserId));
  const result = await agent.createTopicProposal(input, localUserId);

  if (!result.ok)
    return c.json({ error: result.error, diagnostic: result.diagnostic }, 422);
  c.header('Cache-Control', 'no-store');

  return c.json({ proposal: result.proposal }, 201);
});
preferencesRoutes.all('/proposals/:proposalId', allowMethods('PUT'));
preferencesRoutes.put('/proposals/:proposalId', async (c) => {
  if (
    c.req.header('origin') !== new URL(c.req.url).origin ||
    !c.req.header('content-type')?.includes('application/json')
  ) {
    return c.json({ error: 'A same-origin JSON request is required.' }, 403);
  }

  let proposalId;
  let input;

  try {
    proposalId = proposalIdSchema.parse(c.req.param('proposalId'));
    input = proposalActionSchema.parse(await c.req.json<unknown>());
  } catch {
    return c.json({ error: 'Invalid topic proposal action.' }, 400);
  }

  const binding = c.get('binding');
  const agent = binding.get(binding.idFromName(localUserId));
  const result =
    input.action === 'apply'
      ? await agent.applyTopicProposal(proposalId, localUserId)
      : await agent.discardTopicProposal(proposalId, localUserId);

  if (!result.ok) {
    return c.json(
      { error: result.error, currentRevision: result.currentRevision },
      result.currentRevision === undefined ? 422 : 409,
    );
  }
  c.header('Cache-Control', 'no-store');

  return c.json({ preferences: result.preferences });
});
