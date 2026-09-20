import { Hono } from 'hono';
import {
  chatSessionMessagesSchema,
  chatSessionSchema,
  createChatSessionSchema,
} from '../../shared/chat';
import type { PreferencesAgentEnv } from '../preferences-agent';
import {
  allowMethods,
  noStore,
  requireIdentity,
  sameOrigin,
  type HttpEnv,
} from './policy';

type ChatsHttpEnv = HttpEnv & {
  Variables: { binding: PreferencesAgentEnv['PERSONAL_BRIEFING'] };
};

/** Authenticated durable chat-session reads, creation, and deletion. */
export const chatsRoutes = new Hono<ChatsHttpEnv>();

chatsRoutes.use('*', noStore);
chatsRoutes.use('*', async (c, next) => {
  if (c.env.PERSONAL_BRIEFING === undefined)
    return c.json({ error: 'Personal Briefing Agent is not configured.' }, 503);

  c.set('binding', c.env.PERSONAL_BRIEFING);
  await next();
});
chatsRoutes.use('*', requireIdentity);
chatsRoutes.use('*', sameOrigin('Cross-origin chat access is not allowed.'));

chatsRoutes.all('/', allowMethods('GET', 'POST'));
chatsRoutes.get('/', async (c) => {
  const binding = c.get('binding');
  const agent = binding.get(binding.idFromName(c.get('userId')));

  return c.json({ sessions: await agent.listChatSessions(c.get('userId')) });
});
chatsRoutes.post('/', async (c) => {
  if (
    c.req.header('origin') !== new URL(c.req.url).origin ||
    !c.req.header('content-type')?.includes('application/json')
  ) {
    return c.json({ error: 'A same-origin JSON request is required.' }, 403);
  }

  let input;

  try {
    input = createChatSessionSchema.parse(await c.req.json<unknown>());
  } catch {
    return c.json({ error: 'Invalid chat session request.' }, 400);
  }

  const binding = c.get('binding');
  const agent = binding.get(binding.idFromName(c.get('userId')));
  const session = await agent.createChatSession(
    input.briefingRunId,
    input.storyId,
    c.get('userId'),
  );

  if (session === undefined)
    return c.json({ error: 'Briefing story not found.' }, 404);

  return c.json({ session: chatSessionSchema.parse(session) }, 201);
});

chatsRoutes.all('/:sessionId', allowMethods('DELETE'));
chatsRoutes.delete('/:sessionId', async (c) => {
  const sessionId = chatSessionSchema.shape.id.safeParse(
    c.req.param('sessionId'),
  );

  if (!sessionId.success)
    return c.json({ error: 'Invalid chat session ID.' }, 400);
  const binding = c.get('binding');
  const agent = binding.get(binding.idFromName(c.get('userId')));
  const deleted = await agent.deleteChatSession(
    sessionId.data,
    c.get('userId'),
  );

  return deleted
    ? c.body(null, 204)
    : c.json({ error: 'Chat session not found.' }, 404);
});

chatsRoutes.all('/:sessionId/messages', allowMethods('GET'));
chatsRoutes.get('/:sessionId/messages', async (c) => {
  const sessionId = chatSessionSchema.shape.id.safeParse(
    c.req.param('sessionId'),
  );

  if (!sessionId.success)
    return c.json({ error: 'Invalid chat session ID.' }, 400);
  const binding = c.get('binding');
  const agent = binding.get(binding.idFromName(c.get('userId')));
  const session = await agent.readChatSessionMessages(
    sessionId.data,
    c.get('userId'),
  );

  return session === undefined
    ? c.json({ error: 'Chat session not found.' }, 404)
    : c.json(chatSessionMessagesSchema.parse(session));
});
