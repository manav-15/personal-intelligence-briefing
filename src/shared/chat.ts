import { z } from 'zod';

const sessionId = z.uuid();
const runId = z.uuid();
const storyId = z.string().trim().min(1).max(200);
const messageText = z.string().trim().min(1).max(8_000);

/** A durable conversation scoped to one cited story in one saved briefing. */
export const chatSessionSchema = z.strictObject({
  id: sessionId,
  briefingRunId: runId,
  briefingDate: z.iso.date(),
  storyId,
  storyHeadline: z.string().trim().min(1).max(500),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

/** A durable user or Agent turn stored under one chat session. */
export const chatMessageSchema = z.strictObject({
  id: z.string().trim().min(1).max(200),
  role: z.enum(['user', 'assistant']),
  content: messageText,
  createdAt: z.iso.datetime(),
});

/** Browser input for starting a source-scoped conversation. */
export const createChatSessionSchema = z.strictObject({
  briefingRunId: runId,
  storyId,
});

/** Server-owned chat session list. */
export const chatSessionListSchema = z.strictObject({
  sessions: z.array(chatSessionSchema).max(200),
});

/** Server-owned history for one durable session. */
export const chatSessionMessagesSchema = z.strictObject({
  session: chatSessionSchema,
  messages: z.array(chatMessageSchema).max(200),
});

/** One durable source-scoped conversation. */
export type ChatSession = z.infer<typeof chatSessionSchema>;
/** One durable conversation turn. */
export type ChatMessage = z.infer<typeof chatMessageSchema>;
