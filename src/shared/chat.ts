import { z } from 'zod';

const sessionId = z.uuid();
const runId = z.uuid();
const storyId = z.string().trim().min(1).max(200);
const messageText = z.string().trim().min(1).max(8_000);

/** A durable conversation that retains its original story metadata after its briefing is deleted. */
export const chatSessionSchema = z.strictObject({
  id: sessionId,
  briefingRunId: runId.nullable(),
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

/**
 * Bounded article text retained with one published item so a follow-up answer
 * can consult it. This is the deliberate exception to storing citations and
 * metadata only: it is capped at the extraction limit, read only by the chat
 * turn, and deleted with its briefing.
 */
export const briefingEvidenceSchema = z.strictObject({
  sourceUrl: z.url().max(2_000),
  publisher: z.string().trim().min(1).max(500).nullable(),
  evidenceTier: z.enum(['article', 'description', 'headline-only']),
  retrievedAt: z.iso.datetime(),
  characters: z.number().int().nonnegative(),
  truncated: z.boolean(),
  text: z.string().trim().min(1).max(12_000),
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
/** Retained bounded article text for one published item source. */
export type BriefingEvidence = z.infer<typeof briefingEvidenceSchema>;
