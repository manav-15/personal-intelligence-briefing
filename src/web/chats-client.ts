import {
  chatSessionListSchema,
  chatSessionMessagesSchema,
  chatSessionSchema,
  createChatSessionSchema,
  type ChatSession,
} from '../shared/chat';

/** Lists durable conversations from current and archived briefing editions. */
export async function listChatSessions(): Promise<ChatSession[]> {
  const response = await fetch('/api/chats');

  if (!response.ok) throw new Error('Could not load saved conversations.');

  return chatSessionListSchema.parse(await response.json()).sessions;
}

/** Starts a source-scoped conversation for one saved briefing story. */
export async function createChatSession(
  briefingRunId: string,
  storyId: string,
): Promise<ChatSession> {
  const response = await fetch('/api/chats', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(
      createChatSessionSchema.parse({ briefingRunId, storyId }),
    ),
  });

  if (!response.ok) throw new Error('Could not start a saved conversation.');

  return chatSessionSchema.parse((await response.json()).session);
}

/** Reads the durable transcript for one source-scoped conversation. */
export async function readChatSession(sessionId: string) {
  const response = await fetch(
    `/api/chats/${encodeURIComponent(sessionId)}/messages`,
  );

  if (!response.ok) throw new Error('Could not load this conversation.');

  return chatSessionMessagesSchema.parse(await response.json());
}

/** Permanently deletes one conversation and every message it contains. */
export async function deleteChatSession(sessionId: string): Promise<void> {
  const response = await fetch(`/api/chats/${encodeURIComponent(sessionId)}`, {
    method: 'DELETE',
  });

  if (!response.ok) throw new Error('Could not delete this conversation.');
}
