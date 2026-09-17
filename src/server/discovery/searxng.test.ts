import { describe, expect, it, vi } from 'vitest';
import { discoverSearxng } from './searxng';
import type { Fetcher } from './types';

const item = {
  title: 'AI &amp; tools',
  url: 'https://publisher.example/news#section',
  content:
    '<b>A new model</b> supports longer documents and updated developer tools. More technical details are available in the release.',
  engines: ['brave.news'],
  publishedDate: '2026-09-17T08:00:00Z',
};

describe('SearXNG provider interface', () => {
  it.each([
    ['day', 1],
    ['month', 31],
    ['year', 365],
  ] as const)(
    'filters %s by concrete inclusive dates before capping',
    async (timeRange, days) => {
      const now = Date.parse('2026-09-18T08:00:00Z');
      vi.useFakeTimers();
      vi.setSystemTime(now);
      try {
        const dates = [
          null,
          'invalid',
          new Date(now + 1).toISOString(),
          new Date(now - days * 86400000 - 1).toISOString(),
          new Date(now - days * 86400000).toISOString(),
          new Date(now).toISOString(),
        ];
        const result = await discoverSearxng(
          { query: 'AI releases', timeRange, maxResults: 1 },
          'http://localhost:8080',
          (url) => {
            expect(
              url instanceof URL
                ? url.toString()
                : typeof url === 'string'
                  ? url
                  : url.url,
            ).not.toContain('time_range');
            return Promise.resolve(
              Response.json({
                results: dates.map((publishedDate, index) => ({
                  ...item,
                  url: `https://publisher.example/${String(index)}`,
                  publishedDate,
                })),
              }),
            );
          },
        );
        expect(result.stories).toHaveLength(1);
        expect(result.stories[0]?.sourceUrl).toBe(
          'https://publisher.example/4',
        );
        expect(result.dateFilter).toEqual({
          from: new Date(now - days * 86400000).toISOString(),
          to: new Date(now).toISOString(),
          excluded: 4,
          undated: 2,
        });
      } finally {
        vi.useRealTimers();
      }
    },
  );
  it('uses a bounded news query and preserves attributed metadata and engine failures', async () => {
    let requestUrl: URL | null = null;
    const fetcher: Fetcher = (input) => {
      requestUrl = new URL(
        input instanceof URL
          ? input.toString()
          : typeof input === 'string'
            ? input
            : input.url,
      );
      return Promise.resolve(
        Response.json({
          results: [
            item,
            { ...item, engines: ['bing news'] },
            { ...item, url: 'javascript:alert(1)' },
            { title: 'Broken' },
          ],
          unresponsive_engines: [['duckduckgo news', 'Suspended']],
        }),
      );
    };
    const result = await discoverSearxng(
      { query: 'AI releases', maxResults: 5, timeRange: 'any' },
      'http://localhost:8080',
      fetcher,
    );
    expect(String(requestUrl)).not.toContain('time_range=');
    expect(result.stories).toHaveLength(1);
    expect(result.stories[0]).toMatchObject({
      title: 'AI & tools',
      sourceUrl: 'https://publisher.example/news',
      publishedAt: '2026-09-17T08:00:00.000Z',
      engines: ['brave.news', 'bing news'],
      dateProvenance: 'search-metadata',
      description: { kind: 'search-snippet', provider: 'searxng' },
    });
    expect(result.stories[0]?.description?.text).not.toContain('<b>');
    expect(result.failures).toEqual([
      { code: 'provider-engine-failed', message: 'duckduckgo news: Suspended' },
    ]);
  });

  it('keeps unknown dates unknown, omits absent descriptions and caps results', async () => {
    const result = await discoverSearxng(
      { query: 'Liverpool', maxResults: 1, timeRange: 'any' },
      'http://localhost:8080',
      () =>
        Promise.resolve(
          Response.json({
            results: [
              { ...item, content: null, publishedDate: 'unknown' },
              { ...item, url: 'https://other.example/news' },
            ],
          }),
        ),
    );
    expect(result.stories).toHaveLength(1);
    expect(result.stories[0]).toMatchObject({
      publishedAt: null,
      dateProvenance: 'unknown',
    });
    expect(result.stories[0]?.description).toBeUndefined();
  });

  it.each([
    {
      response: new Response('blocked', { status: 429 }),
      code: 'provider-rate-limited',
    },
    {
      response: new Response('HTML challenge', {
        headers: { 'content-type': 'text/html' },
      }),
      code: 'invalid-response',
    },
    { response: Response.json({ wrong: [] }), code: 'invalid-response' },
    {
      response: new Response('broken', {
        headers: { 'content-type': 'application/json' },
      }),
      code: 'invalid-response',
    },
    {
      response: new Response('x'.repeat(750_001), {
        headers: { 'content-type': 'application/json' },
      }),
      code: 'response-too-large',
    },
  ])('returns recoverable failures for $code', async ({ response, code }) => {
    const result = await discoverSearxng(
      { query: 'AI releases' },
      'http://localhost:8080',
      () => Promise.resolve(response),
    );
    expect(result.stories).toEqual([]);
    expect(result.failures[0]?.code).toBe(code);
  });

  it('reports an unreachable local instance without throwing', async () => {
    const result = await discoverSearxng(
      { query: 'AI releases' },
      'http://localhost:8080',
      () => Promise.reject(new Error('offline')),
    );
    expect(result.failures[0]?.code).toBe('provider-fetch-failed');
  });
});
