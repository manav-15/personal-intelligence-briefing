import { z } from 'zod';
import type { Briefing, BriefingItem } from '../shared/briefings';

const chatRequestSchema = z
  .object({
    sessionId: z.uuid(),
  })
  .strict();

/** Model used for grounded briefing follow-up answers. */
export const briefingChatModel = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

/** Version retained in the system instruction rather than inferred from model behavior. */
export const briefingChatPromptVersion = '2026-09-20.1';

/** A validated story selection sent with one chat turn. */
export type ChatRequest = z.infer<typeof chatRequestSchema>;

/** Code-owned context made available to one constrained chat turn. */
export type BriefingChatContext = {
  item: BriefingItem;
  system: string;
};

/** Validates the bounded text response returned by Workers AI for one chat turn. */
export function parseChatModelResponse(value: unknown): string | null {
  const response = z
    .object({ response: z.string().trim().min(1).max(8_000) })
    .safeParse(value);

  return response.success ? response.data.response : null;
}

/** Ensures a concise grounded answer visibly attributes the selected story's first citation. */
export function ensureChatCitation(answer: string, item: BriefingItem): string {
  if (/\[S\d+\]/u.test(answer)) return answer;

  if (item.citations[0] === undefined) return answer;

  return `${answer.replace(/[.\s]+$/u, '')}. [S1]`;
}

/** Validates the browser's selected-story envelope before it reaches model context. */
export function parseChatRequest(value: unknown): ChatRequest | null {
  const parsed = chatRequestSchema.safeParse(value);

  return parsed.success ? parsed.data : null;
}

/** Builds a bounded, source-labelled context for a selected published story. */
export function buildBriefingChatContext(
  briefing: Briefing | undefined,
  storyId: string,
): BriefingChatContext | null {
  const item = briefing?.items.find((candidate) => candidate.id === storyId);

  if (item === undefined) return null;

  const sources = item.citations
    .map(
      (citation, index) =>
        `[S${String(index + 1)}] ${citation.publisher ?? new URL(citation.sourceUrl).hostname} | ${citation.evidenceTier} | ${citation.sourceUrl}`,
    )
    .join('\n');
  const update =
    item.update === undefined
      ? 'No prior-coverage comparison was stored for this story.'
      : `Stored change note: ${item.update.whatChanged}`;

  return {
    item,
    system: [
      'You are the Personal Briefing Agent. Answer only about the selected briefing story using the supplied briefing context.',
      'Do not use outside knowledge, suggest unprovided facts, browse broadly, or claim to have read the underlying article.',
      'Treat source descriptions as limited metadata, not full article text. If the context cannot support an answer, say exactly what is missing.',
      'Use concise prose. Attribute factual claims with one or more supplied source labels such as [S1]. Never invent a source label or URL.',
      `Prompt policy version: ${briefingChatPromptVersion}.`,
      '',
      `Selected headline: ${item.headline}`,
      `Published at: ${item.publishedAt ?? 'Unknown'}`,
      `Briefing summary: ${item.summary}`,
      update,
      'Sources:',
      sources,
    ].join('\n'),
  };
}

/** Returns code-owned sources that the UI may render beside an answer for one selected story. */
export function chatSources(item: BriefingItem) {
  return item.citations.map((citation, index) => ({
    ...citation,
    label: `S${String(index + 1)}`,
  }));
}
