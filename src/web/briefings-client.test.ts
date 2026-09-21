import { afterEach, describe, expect, it, vi } from 'vitest';
import { briefingSchema } from '../shared/briefings';
import {
  deleteBriefing,
  generateBriefing,
  listBriefingArchive,
  readBriefingRunStatus,
  readTodayBriefing,
} from './briefings-client';

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
  it('validates briefing reads, generation, and run status responses', async () => {
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
      )
      .mockResolvedValueOnce(
        Response.json({ runId: exampleBriefing.runId, created: true }),
      )
      .mockResolvedValueOnce(
        Response.json({
          runId: exampleBriefing.runId,
          status: 'running',
          failureMessage: null,
          collectionFailures: [],
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    vi.stubGlobal('fetch', fetcher);

    await expect(readTodayBriefing()).resolves.toEqual(exampleBriefing);
    await expect(listBriefingArchive()).resolves.toHaveLength(1);
    await expect(generateBriefing()).resolves.toEqual({
      runId: exampleBriefing.runId,
      created: true,
    });
    await expect(
      readBriefingRunStatus(exampleBriefing.runId),
    ).resolves.toMatchObject({
      runId: exampleBriefing.runId,
      status: 'running',
    });
    await expect(
      deleteBriefing(exampleBriefing.runId),
    ).resolves.toBeUndefined();
    expect(fetcher).toHaveBeenNthCalledWith(1, '/api/briefings/today');
    expect(fetcher).toHaveBeenNthCalledWith(2, '/api/briefings/archive');
    expect(fetcher).toHaveBeenNthCalledWith(3, '/api/briefings/generate', {
      method: 'POST',
    });
    expect(fetcher).toHaveBeenNthCalledWith(
      4,
      `/api/briefings/runs/${exampleBriefing.runId}`,
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      5,
      `/api/briefings/${exampleBriefing.runId}`,
      { method: 'DELETE' },
    );
  });
});
