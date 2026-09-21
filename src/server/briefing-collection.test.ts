import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { examplePreferences } from '../shared/preferences';
import {
  collectBriefingCandidates,
  defaultBriefingCollectionBudget,
  type BriefingCollectionSnapshot,
} from './briefing-collection';
import type { Fetcher } from './discovery';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-19T07:00:00Z'));
});
afterEach(() => vi.useRealTimers());

const snapshot = {
  runId: 'ad7fb1a7-9d5d-4cbe-a571-c8e3a0d0f0ee',
  preferenceRevision: examplePreferences.revision,
  preferences: examplePreferences,
  budget: defaultBriefingCollectionBudget,
};
const article = `<article>${'Evidence from the publisher. '.repeat(30)}</article>`;
const lead = {
  title: 'Recent AI model release',
  url: 'https://publisher.example/article',
  publishedDate: '2026-09-19T06:00:00Z',
  engines: ['duckduckgo news'],
};

function searchResponse(results = [lead], errors: string[][] = []) {
  return Response.json({ results, unresponsive_engines: errors });
}

function collect(
  search: Fetcher,
  evidence: Fetcher,
  budget: BriefingCollectionSnapshot['budget'] = snapshot.budget,
) {
  return collectBriefingCandidates({ ...snapshot, budget }, evidence, {
    searxng: { baseUrl: 'http://searxng.test', fetcher: search },
  });
}

function publisherResponse() {
  return Promise.resolve(
    new Response(article, { headers: { 'content-type': 'text/html' } }),
  );
}

describe('SearXNG-only briefing collection', () => {
  it('uses SearXNG exclusively and merges identical URLs across topics', async () => {
    const search = vi.fn(() => Promise.resolve(searchResponse()));
    const evidence = vi.fn(publisherResponse);
    const result = await collect(search, evidence);

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.topicIds).toEqual(
      examplePreferences.topics
        .filter((topic) => topic.enabled)
        .map((topic) => topic.id),
    );
    expect(result.candidates[0]?.evidenceTier).toBe('article');
    expect(evidence).toHaveBeenCalledTimes(1);
    expect(
      result.diagnostics?.queries.every(
        (query) => query.provider === 'searxng',
      ),
    ).toBe(true);
    expect(search.mock.calls.length).toBeGreaterThan(0);
  });

  it('retains useful results when another SearXNG engine fails', async () => {
    const result = await collect(
      () => Promise.resolve(searchResponse([lead], [['bing news', 'timeout']])),
      publisherResponse,
    );

    expect(result.candidates).toHaveLength(1);
    expect(result.failures).toContainEqual(
      expect.objectContaining({ stage: 'discovery', provider: 'searxng' }),
    );
    expect(result.diagnostics?.queries[0]?.status).toBe('partial');
    expect(result.diagnostics?.candidates[0]?.engines).toEqual([
      'duckduckgo news',
    ]);
  });

  it('reports a missing provider without silently falling back or making requests', async () => {
    const fetcher = vi.fn();
    const result = await collectBriefingCandidates(snapshot, fetcher);

    expect(result.candidates).toEqual([]);
    expect(result.failures).toContainEqual(
      expect.objectContaining({ message: 'SearXNG is not configured.' }),
    );
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('contains total provider failure without calling another service', async () => {
    const search = vi.fn(() =>
      Promise.resolve(new Response('unavailable', { status: 503 })),
    );
    const evidence = vi.fn();
    const result = await collect(search, evidence);

    expect(result.candidates).toEqual([]);
    expect(result.failures.length).toBeGreaterThan(0);
    expect(
      result.failures.every(
        (failure) =>
          failure.provider === 'searxng' || failure.stage === 'budget',
      ),
    ).toBe(true);
    expect(evidence).not.toHaveBeenCalled();
  });

  it('rejects stale and future leads before article retrieval', async () => {
    const results = [
      lead,
      {
        ...lead,
        url: 'https://publisher.example/stale',
        publishedDate: '2026-09-16T06:00:00Z',
      },
      {
        ...lead,
        url: 'https://publisher.example/future',
        publishedDate: '2026-09-20T06:00:00Z',
      },
    ];
    const evidence = vi.fn(publisherResponse);
    const result = await collect(
      () => Promise.resolve(searchResponse(results)),
      evidence,
    );

    expect(result.candidates).toHaveLength(1);
    expect(evidence).toHaveBeenCalledTimes(1);
    expect(result.diagnostics?.candidates.map((item) => item.outcome)).toEqual(
      expect.arrayContaining(['stale', 'future-date']),
    );
  });

  it('round-robins topics and preserves independent interest queries within the budget', async () => {
    const seen: string[] = [];
    const search: Fetcher = (input) => {
      const url = new URL(input instanceof Request ? input.url : input);

      seen.push(url.searchParams.get('q') ?? '');
      expect(url.hostname).toBe('searxng.test');
      expect(url.searchParams.has('time_range')).toBe(false);

      return Promise.resolve(searchResponse([]));
    };
    const result = await collect(search, publisherResponse, {
      ...snapshot.budget,
      maxQueries: 3,
    });

    expect(seen).toHaveLength(3);
    expect(
      new Set(result.diagnostics?.queries.map((query) => query.topicId)).size,
    ).toBe(3);
    expect(result.failures).toContainEqual(
      expect.objectContaining({ stage: 'budget' }),
    );
  });

  it('caps evidence retrieval independently of candidate discovery', async () => {
    const results = Array.from({ length: 4 }, (_, index) => ({
      ...lead,
      url: `https://publisher.example/${String(index)}`,
    }));
    const evidence = vi.fn(publisherResponse);
    const result = await collect(
      () => Promise.resolve(searchResponse(results)),
      evidence,
      { ...snapshot.budget, maxEvidenceFetches: 1 },
    );

    expect(evidence).toHaveBeenCalledTimes(1);
    expect(result.failures).toContainEqual(
      expect.objectContaining({ stage: 'budget' }),
    );
  });

  it('recovers a publisher date and reuses the same fetch as article evidence', async () => {
    const publisherCalls: string[] = [];
    const [ai] = examplePreferences.topics;
    const testFetcher: Fetcher = (input) => {
      const url = new URL(input instanceof Request ? input.url : input);

      if (url.hostname === 'searxng.test') {
        return Promise.resolve(
          Response.json({
            results: [
              {
                title: 'Fresh AI model release',
                url: 'https://publisher.example/fresh-model',
                engines: ['duckduckgo news'],
              },
            ],
          }),
        );
      }

      publisherCalls.push(url.toString());

      return Promise.resolve(
        new Response(
          `<script type="application/ld+json">{"datePublished":"2026-09-19T06:00:00Z"}</script><article>${'Fresh publisher evidence. '.repeat(30)}</article>`,
          { headers: { 'content-type': 'text/html' } },
        ),
      );
    };

    if (ai === undefined)
      throw new Error('Example preferences need an AI topic.');
    const result = await collectBriefingCandidates(
      {
        runId: 'ad7fb1a7-9d5d-4cbe-a571-c8e3a0d0f0ee',
        preferenceRevision: examplePreferences.revision,
        preferences: { ...examplePreferences, topics: [ai] },
        budget: {
          ...defaultBriefingCollectionBudget,
          maxQueries: 1,
          maxEvidenceFetches: 1,
          maxDateResolutionFetches: 1,
        },
      },
      testFetcher,
      {
        searxng: {
          baseUrl: 'http://searxng.test',
          fetcher: testFetcher,
        },
      },
    );

    expect(publisherCalls).toEqual(['https://publisher.example/fresh-model']);
    expect(result.candidates).toMatchObject([
      {
        story: {
          publishedAt: '2026-09-19T06:00:00.000Z',
          dateProvenance: 'publisher-jsonld',
        },
        evidenceTier: 'article',
      },
    ]);
    expect(result.diagnostics?.candidates[0]).toMatchObject({
      outcome: 'article',
      publishedAt: '2026-09-19T06:00:00.000Z',
      dateProvenance: 'publisher-jsonld',
      engines: ['duckduckgo news'],
    });
  });

  it('retains engine provenance and rejects a live timeline from composition', async () => {
    const [ai] = examplePreferences.topics;
    const testFetcher: Fetcher = (input) => {
      const url = new URL(input instanceof Request ? input.url : input);

      if (url.hostname === 'searxng.test') {
        return Promise.resolve(
          Response.json({
            results: [
              {
                title: 'AI model releases timeline updated daily',
                url: 'https://publisher.example/timeline',
                publishedDate: '2026-09-19T06:00:00Z',
                engines: ['brave.news'],
              },
            ],
          }),
        );
      }

      return Promise.resolve(
        new Response(
          `<title>AI model releases timeline updated daily</title><article>${'Readable timeline text. '.repeat(30)}</article>`,
          { headers: { 'content-type': 'text/html' } },
        ),
      );
    };

    if (ai === undefined)
      throw new Error('Example preferences need an AI topic.');
    const result = await collectBriefingCandidates(
      {
        runId: 'ad7fb1a7-9d5d-4cbe-a571-c8e3a0d0f0ee',
        preferenceRevision: examplePreferences.revision,
        preferences: { ...examplePreferences, topics: [ai] },
        budget: { ...defaultBriefingCollectionBudget, maxQueries: 1 },
      },
      testFetcher,
      { searxng: { baseUrl: 'http://searxng.test', fetcher: testFetcher } },
    );

    expect(result.candidates[0]?.evidenceTier).toBe('headline-only');
    expect(result.diagnostics?.candidates[0]).toMatchObject({
      engines: ['brave.news'],
      outcome: 'non-article-page',
      evidenceReason:
        'The publisher page is an index or live timeline, not a discrete article.',
    });
  });
});
