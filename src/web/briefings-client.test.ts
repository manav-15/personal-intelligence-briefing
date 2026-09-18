import { afterEach, describe, expect, it, vi } from 'vitest';
import { briefingSchema } from '../shared/briefings';
import { listBriefingArchive, readLatestBriefing } from './briefings-client';

const exampleBriefing = briefingSchema.parse({
  schemaVersion: 1,
  runId: 'ad7fb1a7-9d5d-4cbe-a571-c8e3a0d0f0ee',
  date: '2026-09-19',
  preferenceRevision: 3,
  completeness: 'complete',
  limitations: [],
  items: [
    {
      id: 'ai-release',
      topicIds: ['ai'],
      headline: 'Example model release',
      summary: 'The example provider released a model.',
      publishedAt: '2026-09-19T00:00:00.000Z',
      citations: [
        {
          sourceUrl: 'https://example.com/releases/model',
          publisher: 'Example',
          evidenceTier: 'article',
        },
      ],
    },
  ],
  publishedAt: '2026-09-19T01:00:00.000Z',
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('briefing client', () => {
  it('validates Today and Archive responses from the Worker', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ briefing: exampleBriefing }))
      .mockResolvedValueOnce(
        Response.json({
          briefings: [
            {
              runId: exampleBriefing.runId,
              date: exampleBriefing.date,
              completeness: exampleBriefing.completeness,
              itemCount: exampleBriefing.items.length,
              publishedAt: exampleBriefing.publishedAt,
            },
          ],
        }),
      );

    vi.stubGlobal('fetch', fetcher);

    await expect(readLatestBriefing()).resolves.toEqual(exampleBriefing);
    await expect(listBriefingArchive()).resolves.toHaveLength(1);
    expect(fetcher).toHaveBeenNthCalledWith(1, '/api/briefings/today');
    expect(fetcher).toHaveBeenNthCalledWith(2, '/api/briefings/archive');
  });
});
