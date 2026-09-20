import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { examplePreferences } from '../shared/preferences';
import {
  collectBriefingCandidates,
  defaultBriefingCollectionBudget,
} from './briefing-collection';
import type { Fetcher } from './discovery';

const feed = `<?xml version="1.0"?><rss><channel>
  <item><title>AI model release</title><link>https://news.google.com/rss/articles/example</link><source>Example AI</source><pubDate>Fri, 18 Sep 2026 08:00:00 GMT</pubDate></item>
</channel></rss>`;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-19T07:00:00Z'));
});
afterEach(() => vi.useRealTimers());

describe('briefing candidate collection', () => {
  it('queries each topic interest independently instead of concatenating them', async () => {
    const queries: string[] = [];
    const [ai] = examplePreferences.topics;

    if (ai === undefined)
      throw new Error('Example preferences need an AI topic.');
    const result = await collectBriefingCandidates(
      {
        runId: 'ad7fb1a7-9d5d-4cbe-a571-c8e3a0d0f0ee',
        preferenceRevision: examplePreferences.revision,
        preferences: { ...examplePreferences, topics: [ai] },
        budget: { ...defaultBriefingCollectionBudget, maxQueries: 3 },
      },
      (input, init) => {
        const url = new URL(input instanceof Request ? input.url : input);

        if (
          url.hostname === 'news.google.com' &&
          url.pathname === '/rss/search'
        ) {
          queries.push(url.searchParams.get('q') ?? '');

          return Promise.resolve(new Response(feed));
        }

        return fixtureFetcher(input, init);
      },
    );

    expect(queries).toEqual(['Model releases', 'Developer tools']);
    expect(result.diagnostics?.queries.map((query) => query.query)).toEqual([
      'Model releases',
      'Model releases',
      'Developer tools',
    ]);
  });

  it('gives every topic discovery and evidence before spending the remainder', async () => {
    const queries: string[] = [];
    const fetcher: Fetcher = (input) => {
      const url = new URL(input instanceof Request ? input.url : input);

      if (
        url.hostname === 'news.google.com' &&
        url.pathname === '/rss/search'
      ) {
        queries.push(url.searchParams.get('q') ?? '');
        const topic = String(queries.length);

        return Promise.resolve(
          new Response(
            `<rss><channel>${Array.from({ length: 8 }, (_, index) => `<item><title>Recent story ${topic} ${String(index)}</title><link>https://news.google.com/rss/articles/${topic}-${String(index)}</link><pubDate>Sat, 19 Sep 2026 06:00:00 GMT</pubDate></item>`).join('')}</channel></rss>`,
            { headers: { 'content-type': 'application/rss+xml' } },
          ),
        );
      }

      return fixtureFetcher(input);
    };
    const result = await collectBriefingCandidates(
      {
        runId: 'ad7fb1a7-9d5d-4cbe-a571-c8e3a0d0f0ee',
        preferenceRevision: 0,
        preferences: examplePreferences,
        budget: {
          ...defaultBriefingCollectionBudget,
          maxQueries: 3,
          maxCandidates: 3,
          maxEvidenceFetches: 3,
        },
      },
      fetcher,
    );

    expect(queries).toHaveLength(3);
    expect(result.diagnostics?.queries.map((query) => query.returned)).toEqual([
      8, 8, 8,
    ]);
    expect(result.diagnostics?.candidates).toHaveLength(24);
    expect(
      result.diagnostics?.candidates.filter(
        (item) => item.outcome === 'candidate-budget',
      ),
    ).toHaveLength(21);
    expect(
      result.diagnostics?.candidates.filter(
        (item) => item.outcome === 'article',
      ),
    ).toHaveLength(3);
    expect(JSON.stringify(result.diagnostics)).not.toContain(
      'Evidence from the publisher.',
    );
    expect(result.candidates.map((candidate) => candidate.topicIds[0])).toEqual(
      ['ai', 'world', 'liverpool'],
    );
  });

  it('keeps stale and future dates rejected while attempting bounded unknown-date recovery', async () => {
    const seen: string[] = [];
    const fetcher: Fetcher = (input) => {
      const url = new URL(input instanceof Request ? input.url : input);

      seen.push(url.hostname);

      return Promise.resolve(
        new Response(
          `<rss><channel>${[
            'Fri, 18 Sep 2026 06:59:59 GMT',
            'Sat, 19 Sep 2026 07:00:01 GMT',
            '',
          ]
            .map(
              (date, index) =>
                `<item><title>Old AI announcement</title><link>https://news.google.com/rss/articles/${String(index)}</link><pubDate>${date}</pubDate></item>`,
            )
            .join('')}</channel></rss>`,
          { headers: { 'content-type': 'application/rss+xml' } },
        ),
      );
    };
    const result = await collectBriefingCandidates(
      {
        runId: 'ad7fb1a7-9d5d-4cbe-a571-c8e3a0d0f0ee',
        preferenceRevision: 0,
        preferences: examplePreferences,
        budget: { ...defaultBriefingCollectionBudget, maxQueries: 1 },
      },
      fetcher,
    );

    expect(result.candidates).toEqual([]);
    expect(seen).toEqual(['news.google.com', 'news.google.com']);
    expect(result.diagnostics?.candidates.map((item) => item.outcome)).toEqual([
      'stale',
      'future-date',
      'unknown-date',
    ]);
    expect(result.diagnostics?.queries[0]).toMatchObject({
      topicId: 'ai',
      returned: 3,
      status: 'ok',
    });
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

  it('deduplicates exact discovery URLs across topics and retains temporary article evidence', async () => {
    const ai = examplePreferences.topics[0];
    const world = examplePreferences.topics[1];

    if (ai === undefined || world === undefined)
      throw new Error('Example preferences need AI and world topics.');
    const preferences = {
      ...examplePreferences,
      topics: [
        { ...ai, searchConcepts: [] },
        {
          ...world,
          id: 'ai-policy',
          interests: ['Artificial intelligence'],
          searchConcepts: [],
        },
      ],
    };
    const result = await collectBriefingCandidates(
      {
        runId: 'ad7fb1a7-9d5d-4cbe-a571-c8e3a0d0f0ee',
        preferenceRevision: preferences.revision,
        preferences,
        budget: defaultBriefingCollectionBudget,
      },
      fixtureFetcher,
    );

    expect(result.failures).toEqual([]);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({
      topicIds: ['ai', 'ai-policy'],
      evidenceTier: 'article',
      evidence: {
        status: 'usable',
        articleUrl: 'https://publisher.example/article',
      },
    });
  });

  it('uses only configured private SearXNG discovery', async () => {
    const calls: URL[] = [];
    const result = await collectBriefingCandidates(
      {
        runId: 'ad7fb1a7-9d5d-4cbe-a571-c8e3a0d0f0ee',
        preferenceRevision: examplePreferences.revision,
        preferences: examplePreferences,
        budget: { ...defaultBriefingCollectionBudget, maxQueries: 1 },
      },
      fixtureFetcher,
      {
        searxng: {
          baseUrl: 'http://searxng.test',
          fetcher: (input, init) => {
            calls.push(new URL(input instanceof Request ? input.url : input));

            return fixtureFetcher(input, init);
          },
        },
      },
    );

    expect(calls.map((url) => url.hostname)).toEqual(['searxng.test']);
    expect(calls[0]?.searchParams.has('time_range')).toBe(false);
    expect(result.diagnostics?.candidates[0]?.outcome).toBe('unknown-date');
    expect(result.failures).toContainEqual({
      stage: 'budget',
      provider: null,
      message: 'Discovery stopped after reaching the query budget.',
    });
  });

  it('does not call Google News RSS or GDELT when SearXNG is configured', async () => {
    const calls: string[] = [];
    const result = await collectBriefingCandidates(
      {
        runId: 'ad7fb1a7-9d5d-4cbe-a571-c8e3a0d0f0ee',
        preferenceRevision: examplePreferences.revision,
        preferences: examplePreferences,
        budget: { ...defaultBriefingCollectionBudget, maxQueries: 3 },
      },
      fixtureFetcher,
      {
        searxng: {
          baseUrl: 'http://searxng.test',
          fetcher: (input, init) => {
            calls.push(
              new URL(input instanceof Request ? input.url : input).hostname,
            );

            return fixtureFetcher(input, init);
          },
        },
      },
    );

    expect(calls).toEqual(['searxng.test', 'searxng.test', 'searxng.test']);
    expect(result.diagnostics?.queries.map((query) => query.provider)).toEqual([
      'searxng',
      'searxng',
      'searxng',
    ]);
  });

  it('records a configured SearXNG provider failure without fallback discovery', async () => {
    const result = await collectBriefingCandidates(
      {
        runId: 'ad7fb1a7-9d5d-4cbe-a571-c8e3a0d0f0ee',
        preferenceRevision: examplePreferences.revision,
        preferences: examplePreferences,
        budget: { ...defaultBriefingCollectionBudget, maxQueries: 6 },
      },
      fixtureFetcher,
      {
        searxng: { baseUrl: 'not a URL', fetcher: fixtureFetcher },
      },
    );

    expect(result.candidates).toEqual([]);
    expect(result.diagnostics?.queries[0]).toMatchObject({
      provider: 'searxng',
      status: 'failed',
      returned: 0,
      failureCount: 1,
    });
    expect(result.failures).toContainEqual(
      expect.objectContaining({ stage: 'discovery', provider: 'searxng' }),
    );
  });

  it('reports an explicit budget failure without exceeding evidence retrieval', async () => {
    const result = await collectBriefingCandidates(
      {
        runId: 'ad7fb1a7-9d5d-4cbe-a571-c8e3a0d0f0ee',
        preferenceRevision: examplePreferences.revision,
        preferences: examplePreferences,
        budget: {
          ...defaultBriefingCollectionBudget,
          maxQueries: 1,
          maxEvidenceFetches: 1,
        },
      },
      fixtureFetcher,
    );

    expect(result.candidates).toHaveLength(1);
    expect(result.failures).toContainEqual({
      stage: 'budget',
      provider: null,
      message: 'Discovery stopped after reaching the query budget.',
    });
  });
});

const fixtureFetcher: Fetcher = (input) => {
  const url = new URL(
    input instanceof URL
      ? input.toString()
      : typeof input === 'string'
        ? input
        : input.url,
  );

  if (url.hostname === 'news.google.com' && url.pathname === '/rss/search') {
    return Promise.resolve(
      new Response(feed, {
        headers: { 'content-type': 'application/rss+xml' },
      }),
    );
  }

  if (url.hostname === 'news.google.com') {
    return Promise.resolve(
      new Response('', {
        status: 302,
        headers: { location: 'https://publisher.example/article' },
      }),
    );
  }

  if (url.hostname === 'api.gdeltproject.org') {
    return Promise.resolve(
      Response.json(
        { articles: [] },
        { headers: { 'content-type': 'application/json' } },
      ),
    );
  }

  if (url.hostname === 'searxng.test') {
    return Promise.resolve(
      Response.json(
        {
          results: [
            {
              title: 'Private SearXNG result',
              url: 'https://publisher.example/article',
              content: 'A useful attributed search snippet.',
              engines: ['duckduckgo news'],
            },
          ],
        },
        { headers: { 'content-type': 'application/json' } },
      ),
    );
  }

  return Promise.resolve(
    new Response(
      `<article>${'Evidence from the publisher. '.repeat(30)}</article>`,
      {
        headers: { 'content-type': 'text/html' },
      },
    ),
  );
};
