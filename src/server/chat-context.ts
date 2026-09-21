import { z } from 'zod';
import type { BriefingEvidence } from '../shared/chat';
import type { Briefing, BriefingItem } from '../shared/briefings';

const chatRequestSchema = z
  .object({
    sessionId: z.uuid(),
  })
  .strict();

/** Model used for grounded briefing follow-up answers. */
export const briefingChatModel = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

/** Version retained in the system instruction rather than inferred from model behavior. */
export const briefingChatPromptVersion = '2026-09-21.4';

/**
 * Total retained article text supplied to one turn. It is divided across the
 * item's sources so a multi-source item still shows each one a fair window.
 */
const maxChatEvidenceCharacters = 12_000;

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

/** Validates the browser's selected-story envelope before it reaches model context. */
export function parseChatRequest(value: unknown): ChatRequest | null {
  const parsed = chatRequestSchema.safeParse(value);

  return parsed.success ? parsed.data : null;
}

/** Builds a bounded, source-labelled context for a selected published story. */
export function buildBriefingChatContext(
  briefing: Briefing | undefined,
  storyId: string,
  evidence: BriefingEvidence[] = [],
  question = '',
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
  const retained = retainedEvidence(item, evidence);

  return {
    item,
    system: [
      'You are the Personal Briefing Agent. Answer follow-up questions about the selected briefing story.',
      'Use two kinds of information. First, the supplied context: the briefing summary, the stored change note, the source list, and the retrieved article text below, which is a bounded extract captured during collection. Second, your own general knowledge, for background, definitions, and context the supplied sources do not cover.',
      'Attribute anything taken from the supplied context to its source label, such as [S1], as you write it: labels are yours to add, and an unlabelled claim cannot be traced by the owner. Never attach a source label to something you know from general knowledge, and introduce that material with the word "Background:" so the owner can see which parts came from the sources.',
      'You cannot query the internet or any other source. When the owner asks you to look something up, check a site, fetch the latest news, or verify anything outside this context, say plainly that you have no internet access and cannot query other sources, and then answer from the supplied context and your own knowledge.',
      'Never claim to have browsed, fetched, opened, or read the live page, and never imply that a lookup happened. If a question needs something neither the supplied context nor your own knowledge covers, name what is missing rather than guessing.',
      'Retrieved text below is a bounded extract of the article captured during collection, so it may be incomplete and the live page may differ; never claim to have read beyond it.',
      'Treat source descriptions as limited metadata.',
      'Use concise prose. Never invent a source label or URL.',
      `Prompt policy version: ${briefingChatPromptVersion}.`,
      '',
      'Answer the latest question, which is stated below. Earlier turns are context for it, not the question to answer.',
      `Latest question: ${question}`,
      '',
      `Selected headline: ${item.headline}`,
      `Published at: ${item.publishedAt ?? 'Unknown'}`,
      `Briefing summary: ${item.summary}`,
      update,
      'Sources:',
      sources,
      '',
      retained,
    ].join('\n'),
  };
}

/** Renders the bounded retained text per source, or states that none was kept. */
function retainedEvidence(
  item: BriefingItem,
  evidence: BriefingEvidence[],
): string {
  const bySource = new Map(evidence.map((entry) => [entry.sourceUrl, entry]));
  const perSource = Math.floor(
    maxChatEvidenceCharacters / Math.max(1, item.citations.length),
  );
  const blocks = item.citations.flatMap((citation, index) => {
    const entry = bySource.get(citation.sourceUrl);

    if (entry === undefined || !entry.text.trim()) return [];
    const text = entry.text.slice(0, perSource);

    return [
      `[S${String(index + 1)}] retrieved ${entry.retrievedAt}${text.length < entry.text.length ? ` (first ${String(text.length)} characters)` : ''}: ${text}`,
    ];
  });

  if (blocks.length === 0)
    return 'Retrieved article text: none was retained for this story, so answer only from the briefing summary and source metadata.';

  return ['Retrieved article text from the collection run:', ...blocks].join(
    '\n',
  );
}

/** Returns code-owned sources that the UI may render beside an answer for one selected story. */
export function chatSources(item: BriefingItem) {
  return item.citations.map((citation, index) => ({
    ...citation,
    label: `S${String(index + 1)}`,
  }));
}
