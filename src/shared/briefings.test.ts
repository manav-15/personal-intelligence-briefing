import { describe, expect, it } from 'vitest';
import {
  briefingArchiveEntrySchema,
  briefingRunInputSchema,
  briefingSchema,
} from './briefings';

export const exampleBriefing = briefingSchema.parse({
  schemaVersion: 1,
  runId: 'e61584be-72fd-4f78-b765-1c302ac57ab7',
  date: '2026-09-19',
  preferenceRevision: 13,
  completeness: 'partial',
  limitations: [
    {
      code: 'provider-rate-limited',
      message: 'One provider was rate limited.',
    },
  ],
  items: [
    {
      id: 'ai-model-release',
      topicIds: ['ai'],
      headline: 'Example AI model release',
      summary: 'A validated fixture summary with a cited publisher source.',
      publishedAt: '2026-09-19T01:00:00.000Z',
      citations: [
        {
          sourceUrl: 'https://example.com/ai-model-release',
          publisher: 'Example Publisher',
          evidenceTier: 'article',
        },
      ],
    },
  ],
  publishedAt: '2026-09-19T02:00:00.000Z',
});

describe('briefing persistence contracts', () => {
  it('keeps citations and evidence tiers without article body text', () => {
    expect(exampleBriefing.items[0]?.citations[0]).toEqual({
      sourceUrl: 'https://example.com/ai-model-release',
      publisher: 'Example Publisher',
      evidenceTier: 'article',
    });
    expect(JSON.stringify(exampleBriefing)).not.toContain('article text');
  });

  it('requires an item citation and a valid run snapshot', () => {
    expect(
      briefingSchema.safeParse({
        ...exampleBriefing,
        items: [{ ...exampleBriefing.items[0], citations: [] }],
      }).success,
    ).toBe(false);
    expect(
      briefingRunInputSchema.safeParse({
        runId: exampleBriefing.runId,
        preferenceRevision: exampleBriefing.preferenceRevision,
      }).success,
    ).toBe(true);
  });

  it('validates archive metadata without the full briefing item list', () => {
    expect(
      briefingArchiveEntrySchema.parse({
        runId: exampleBriefing.runId,
        date: exampleBriefing.date,
        completeness: exampleBriefing.completeness,
        itemCount: exampleBriefing.items.length,
        publishedAt: exampleBriefing.publishedAt,
      }),
    ).not.toHaveProperty('items');
  });
});
