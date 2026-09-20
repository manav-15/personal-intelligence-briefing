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
    const fetcher: Fetcher = (input, init) => {
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

      return fixtureFetcher(input, init);
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
          maxGoogleNewsDecodes: 24,
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

  it('separates a failed decode from leads the decode budget never reached', async () => {
    const seen: string[] = [];
    const [ai] = examplePreferences.topics;

    if (ai === undefined)
      throw new Error('Example preferences need an AI topic.');
    const fetcher: Fetcher = (input, init) => {
      const url = new URL(input instanceof Request ? input.url : input);

      seen.push(`${url.hostname}${url.pathname}`);

      if (
        url.hostname === 'news.google.com' &&
        url.pathname === '/rss/articles/1'
      )
        return Promise.resolve(new Response('captcha'));

      if (
        url.hostname === 'news.google.com' &&
        url.pathname === '/rss/search'
      ) {
        return Promise.resolve(
          new Response(
            `<rss><channel>${[0, 1, 2]
              .map(
                (index) =>
                  `<item><title>Recent AI story ${String(index)}</title><link>https://news.google.com/rss/articles/${String(index)}</link><pubDate>Sat, 19 Sep 2026 06:00:00 GMT</pubDate></item>`,
              )
              .join('')}</channel></rss>`,
            { headers: { 'content-type': 'application/rss+xml' } },
          ),
        );
      }

      return fixtureFetcher(input, init);
    };
    const result = await collectBriefingCandidates(
      {
        runId: 'ad7fb1a7-9d5d-4cbe-a571-c8e3a0d0f0ee',
        preferenceRevision: 0,
        preferences: { ...examplePreferences, topics: [ai] },
        budget: {
          ...defaultBriefingCollectionBudget,
          maxQueries: 1,
          maxGoogleNewsDecodes: 2,
        },
      },
      fetcher,
    );

    expect(result.candidates.map((candidate) => candidate.story)).toMatchObject(
      [
        {
          sourceUrl: 'https://publisher.example/0',
          discoveryUrl: 'https://news.google.com/rss/articles/0',
        },
      ],
    );
    expect(
      result.diagnostics?.candidates.map((item) => ({
        outcome: item.outcome,
        sourceUrl: item.sourceUrl,
        discoveryUrl: item.discoveryUrl,
      })),
    ).toEqual([
      {
        outcome: 'article',
        sourceUrl: 'https://publisher.example/0',
        discoveryUrl: 'https://news.google.com/rss/articles/0',
      },
      {
        outcome: 'decode-failed',
        sourceUrl: 'https://news.google.com/rss/articles/1',
        discoveryUrl: undefined,
      },
      {
        outcome: 'decode-budget',
        sourceUrl: 'https://news.google.com/rss/articles/2',
        discoveryUrl: undefined,
      },
    ]);
    expect(result.diagnostics?.queries[0]).toMatchObject({
      returned: 3,
      status: 'partial',
      failureCount: 1,
    });
    expect(
      seen.filter((entry) => entry.startsWith('news.google.com/rss/articles/')),
    ).toEqual([
      'news.google.com/rss/articles/0',
      'news.google.com/rss/articles/1',
    ]);
    expect(
      seen.filter((entry) => entry.startsWith('publisher.example')),
    ).toEqual(['publisher.example/0']);
    expect(result.failures).toEqual([
      {
        stage: 'budget',
        provider: 'google-news',
        message:
          'Google News publisher-link decoding stopped after reaching its budget.',
      },
      {
        stage: 'discovery',
        provider: 'google-news',
        message:
          'https://news.google.com/rss/articles/1: Google News challenged publisher-link decoding.',
      },
      {
        stage: 'budget',
        provider: null,
        message: 'Discovery stopped after reaching the query budget.',
      },
    ]);
  });

  it('spends a single decode on the freshest Google lead', async () => {
    const seen: string[] = [];
    const [ai] = examplePreferences.topics;

    if (ai === undefined)
      throw new Error('Example preferences need an AI topic.');
    const fetcher: Fetcher = (input, init) => {
      const url = new URL(input instanceof Request ? input.url : input);

      seen.push(`${url.hostname}${url.pathname}`);

      if (
        url.hostname === 'news.google.com' &&
        url.pathname === '/rss/search'
      ) {
        return Promise.resolve(
          new Response(
            `<rss><channel>${[
              { date: 'Thu, 17 Sep 2026 06:00:00 GMT', id: '0' },
              { date: 'Sat, 19 Sep 2026 05:00:00 GMT', id: '1' },
              { date: 'Sat, 19 Sep 2026 06:30:00 GMT', id: '2' },
            ]
              .map(
                (item) =>
                  `<item><title>Recent AI story ${item.id}</title><link>https://news.google.com/rss/articles/${item.id}</link><pubDate>${item.date}</pubDate></item>`,
              )
              .join('')}</channel></rss>`,
            { headers: { 'content-type': 'application/rss+xml' } },
          ),
        );
      }

      return fixtureFetcher(input, init);
    };
    const result = await collectBriefingCandidates(
      {
        runId: 'ad7fb1a7-9d5d-4cbe-a571-c8e3a0d0f0ee',
        preferenceRevision: 0,
        preferences: { ...examplePreferences, topics: [ai] },
        budget: {
          ...defaultBriefingCollectionBudget,
          maxQueries: 1,
          maxGoogleNewsDecodes: 1,
        },
      },
      fetcher,
    );

    expect(
      seen.filter((entry) => entry.startsWith('news.google.com/rss/articles/')),
    ).toEqual(['news.google.com/rss/articles/2']);
    expect(
      result.candidates.map((candidate) => candidate.story.sourceUrl),
    ).toEqual(['https://publisher.example/2']);
    expect(result.diagnostics?.candidates.map((item) => item.outcome)).toEqual([
      'stale',
      'decode-budget',
      'article',
    ]);
  });

  it('rejects stale and future dates before decoding while attempting bounded unknown-date recovery', async () => {
    const seen: string[] = [];
    const fetcher: Fetcher = (input, init) => {
      const url = new URL(input instanceof Request ? input.url : input);

      seen.push(`${url.hostname}${url.pathname}`);

      if (url.pathname.startsWith('/rss/articles/')) {
        return Promise.resolve(
          new Response('<div data-n-a-sg="signature" data-n-a-ts="123"></div>'),
        );
      }

      if (url.pathname.includes('batchexecute')) {
        return Promise.resolve(new Response(decoderResponse(init)));
      }

      return Promise.resolve(
        new Response(
          `<rss><channel>${[
            'Thu, 17 Sep 2026 06:59:59 GMT',
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
    expect(
      seen.filter((entry) => entry === 'news.google.com/rss/articles/0'),
    ).toEqual([]);
    expect(
      seen.filter((entry) => entry === 'news.google.com/rss/articles/1'),
    ).toEqual([]);
    expect(seen.filter((entry) => entry.startsWith('news.google.com'))).toEqual(
      [
        'news.google.com/rss/search',
        'news.google.com/rss/articles/2',
        'news.google.com/_/DotsSplashUi/data/batchexecute',
      ],
    );
    expect(
      seen.filter((entry) => entry.startsWith('publisher.example')),
    ).toEqual(['publisher.example/2']);
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

  it('accepts a lead at the two-day briefing boundary and rejects the lead past it', async () => {
    const seen: string[] = [];
    const [ai] = examplePreferences.topics;

    if (ai === undefined)
      throw new Error('Example preferences need an AI topic.');
    // The run clock is 2026-09-19T07:00Z, so the window opens at 2026-09-17T07:00Z.
    const fetcher: Fetcher = (input, init) => {
      const url = new URL(input instanceof Request ? input.url : input);

      seen.push(`${url.hostname}${url.pathname}`);

      if (
        url.hostname === 'news.google.com' &&
        url.pathname === '/rss/search'
      ) {
        return Promise.resolve(
          new Response(
            `<rss><channel>${[
              { date: 'Thu, 17 Sep 2026 07:00:00 GMT', id: 'boundary' },
              { date: 'Thu, 17 Sep 2026 06:59:59 GMT', id: 'past-boundary' },
            ]
              .map(
                (item) =>
                  `<item><title>Recent AI story ${item.id}</title><link>https://news.google.com/rss/articles/${item.id}</link><pubDate>${item.date}</pubDate></item>`,
              )
              .join('')}</channel></rss>`,
            { headers: { 'content-type': 'application/rss+xml' } },
          ),
        );
      }

      return fixtureFetcher(input, init);
    };
    const result = await collectBriefingCandidates(
      {
        runId: 'ad7fb1a7-9d5d-4cbe-a571-c8e3a0d0f0ee',
        preferenceRevision: 0,
        preferences: { ...examplePreferences, topics: [ai] },
        budget: { ...defaultBriefingCollectionBudget, maxQueries: 1 },
      },
      fetcher,
    );

    expect(
      seen.filter((entry) => entry.startsWith('news.google.com/rss/articles/')),
    ).toEqual(['news.google.com/rss/articles/boundary']);
    expect(
      result.candidates.map((candidate) => candidate.story.sourceUrl),
    ).toEqual(['https://publisher.example/boundary']);
    expect(result.diagnostics?.candidates.map((item) => item.outcome)).toEqual([
      'article',
      'stale',
    ]);
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
        articleUrl: 'https://publisher.example/example',
      },
    });
  });

  it('starts a run with the configured private SearXNG discovery', async () => {
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

  it('adds the decoded Google News channel after each topic SearXNG pass', async () => {
    const seen: string[] = [];
    const fetcher: Fetcher = (input, init) => {
      const url = new URL(input instanceof Request ? input.url : input);

      seen.push(`${url.hostname}${url.pathname}`);

      return fixtureFetcher(input, init);
    };
    const result = await collectBriefingCandidates(
      {
        runId: 'ad7fb1a7-9d5d-4cbe-a571-c8e3a0d0f0ee',
        preferenceRevision: examplePreferences.revision,
        preferences: examplePreferences,
        budget: { ...defaultBriefingCollectionBudget, maxQueries: 6 },
      },
      fetcher,
      { searxng: { baseUrl: 'http://searxng.test', fetcher } },
    );

    expect(result.diagnostics?.queries.map((query) => query.provider)).toEqual([
      'searxng',
      'searxng',
      'searxng',
      'google-news',
      'google-news',
      'google-news',
    ]);
    expect(seen.some((entry) => entry.startsWith('api.gdeltproject.org'))).toBe(
      false,
    );
    expect(
      result.candidates.map((candidate) => ({
        provider: candidate.story.discovery,
        sourceUrl: candidate.story.sourceUrl,
        discoveryUrl: candidate.story.discoveryUrl,
      })),
    ).toEqual([
      {
        provider: 'google-news',
        sourceUrl: 'https://publisher.example/example',
        discoveryUrl: 'https://news.google.com/rss/articles/example',
      },
    ]);
  });

  it('records a SearXNG provider failure while the Google News channel still collects', async () => {
    const result = await collectBriefingCandidates(
      {
        runId: 'ad7fb1a7-9d5d-4cbe-a571-c8e3a0d0f0ee',
        preferenceRevision: examplePreferences.revision,
        preferences: examplePreferences,
        budget: { ...defaultBriefingCollectionBudget, maxQueries: 6 },
      },
      fixtureFetcher,
      { searxng: { baseUrl: 'not a URL', fetcher: fixtureFetcher } },
    );

    expect(result.diagnostics?.queries[0]).toMatchObject({
      provider: 'searxng',
      status: 'failed',
      returned: 0,
      failureCount: 1,
    });
    expect(result.failures).toContainEqual(
      expect.objectContaining({ stage: 'discovery', provider: 'searxng' }),
    );
    expect(
      result.diagnostics?.queries.filter(
        (query) => query.provider === 'google-news' && query.returned > 0,
      ),
    ).toHaveLength(3);
    expect(
      result.candidates.map((candidate) => candidate.story.discovery),
    ).toEqual(['google-news']);
  });

  it('splits the decode budget across Google queries instead of spending it on one', async () => {
    const fetcher: Fetcher = (input, init) => {
      const url = new URL(input instanceof Request ? input.url : input);

      if (
        url.hostname === 'news.google.com' &&
        url.pathname === '/rss/search'
      ) {
        return Promise.resolve(
          new Response(
            `<rss><channel>${[0, 1, 2]
              .map(
                (index) =>
                  `<item><title>Recent AI story ${String(index)}</title><link>https://news.google.com/rss/articles/${String(index)}</link><pubDate>Sat, 19 Sep 2026 06:00:00 GMT</pubDate></item>`,
              )
              .join('')}</channel></rss>`,
            { headers: { 'content-type': 'application/rss+xml' } },
          ),
        );
      }

      return fixtureFetcher(input, init);
    };
    const result = await collectBriefingCandidates(
      {
        runId: 'ad7fb1a7-9d5d-4cbe-a571-c8e3a0d0f0ee',
        preferenceRevision: examplePreferences.revision,
        preferences: examplePreferences,
        budget: {
          ...defaultBriefingCollectionBudget,
          maxQueries: 6,
          maxGoogleNewsDecodes: 3,
        },
      },
      fetcher,
      { searxng: { baseUrl: 'http://searxng.test', fetcher } },
    );

    expect(
      [3, 4, 5].map((queryIndex) =>
        result.diagnostics?.candidates
          .filter((candidate) => candidate.queryIndex === queryIndex)
          .map((candidate) => candidate.outcome),
      ),
    ).toEqual([
      ['article', 'decode-budget', 'decode-budget'],
      ['article', 'decode-budget', 'decode-budget'],
      ['article', 'decode-budget', 'decode-budget'],
    ]);
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

const fixtureFetcher: Fetcher = (input, init) => {
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
    if (url.pathname.startsWith('/rss/articles/')) {
      return Promise.resolve(
        new Response('<div data-n-a-sg="signature" data-n-a-ts="123"></div>'),
      );
    }

    if (url.pathname.includes('batchexecute')) {
      return Promise.resolve(new Response(decoderResponse(init)));
    }

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

function decoderResponse(init: RequestInit | undefined): string {
  const body = init?.body;

  if (!(body instanceof URLSearchParams))
    throw new Error('Expected decoder form body.');
  const outer = JSON.parse(body.get('f.req') ?? '') as unknown[][][];
  const request = outer[0]?.[0]?.[1];

  if (typeof request !== 'string') throw new Error('Expected decoder request.');
  const decoderRequest: unknown = JSON.parse(request);
  const articleId = Array.isArray(decoderRequest)
    ? (decoderRequest as unknown[])[2]
    : undefined;

  if (typeof articleId !== 'string') throw new Error('Expected article ID.');

  return `)]}'\n\n${JSON.stringify([
    [
      'wrb.fr',
      'Fbv4je',
      JSON.stringify([null, `https://publisher.example/${articleId}`]),
    ],
  ])}`;
}
