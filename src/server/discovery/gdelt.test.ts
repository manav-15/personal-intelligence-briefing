import { describe, expect, it } from 'vitest';
import { discoverGdelt, gdeltSearchUrl } from './gdelt';

const article = {
  url: 'https://publisher.example/news#section',
  title: ' AI release ',
  language: 'English',
  seendate: '20260917T080000Z',
};

function jsonResponse(articles: unknown[]): Response {
  return Response.json({ articles });
}

describe('GDELT discovery', () => {
  it('builds a bounded English query without exposing query operators as URL parameters', () => {
    const url = gdeltSearchUrl({ query: 'Liverpool FC', maxResults: 3 });

    expect(url.searchParams.get('query')).toBe(
      'Liverpool FC sourcelang:english',
    );
    expect(url.searchParams.get('maxrecords')).toBe('3');
    expect(url.searchParams.get('timespan')).toBe('1week');
    expect(url.searchParams.get('mode')).toBe('artlist');
  });

  it('normalizes direct links, deduplicates and rejects unusable records', async () => {
    const result = await discoverGdelt({ query: 'AI news' }, () =>
      Promise.resolve(
        jsonResponse([
          article,
          { ...article, url: 'https://publisher.example/news' },
          { ...article, language: 'French' },
          { ...article, url: 'javascript:alert(1)' },
          {
            ...article,
            url: 'https://user:password@publisher.example/private',
          },
          { title: 'Missing link' },
        ]),
      ),
    );

    expect(result).toEqual({
      stories: [
        {
          id: 'https://publisher.example/news',
          title: 'AI release',
          publisher: 'publisher.example',
          publishedAt: null,
          sourceUrl: 'https://publisher.example/news',
          discovery: 'gdelt',
        },
      ],
      failures: [],
    });
  });

  it('caps returned records even when the provider ignores maxrecords', async () => {
    const result = await discoverGdelt(
      { query: 'AI news', maxResults: 1 },
      () =>
        Promise.resolve(
          jsonResponse([
            article,
            { ...article, url: 'https://publisher.example/second' },
          ]),
        ),
    );

    expect(result.stories).toHaveLength(1);
  });

  it('distinguishes rate limits without retrying', async () => {
    let requests = 0;
    const result = await discoverGdelt({ query: 'AI news' }, () => {
      requests += 1;

      return Promise.resolve(new Response('Slow down', { status: 429 }));
    });

    expect(requests).toBe(1);
    expect(result.failures[0]?.code).toBe('provider-rate-limited');
  });

  it.each([
    new Response('<html>Challenge</html>', {
      headers: { 'content-type': 'text/html' },
    }),
    new Response('broken JSON', {
      headers: { 'content-type': 'application/json' },
    }),
    Response.json({ error: 'Not an article list' }),
  ])('reports malformed output as a recoverable failure', async (response) => {
    const result = await discoverGdelt({ query: 'AI news' }, () =>
      Promise.resolve(response),
    );

    expect(result.stories).toEqual([]);
    expect(result.failures[0]?.code).toBe('invalid-response');
  });

  it('accepts an empty article list', async () => {
    await expect(
      discoverGdelt({ query: 'AI news' }, () =>
        Promise.resolve(jsonResponse([])),
      ),
    ).resolves.toEqual({ stories: [], failures: [] });
  });

  it('limits actual streamed bytes even without a content-length header', async () => {
    const result = await discoverGdelt({ query: 'AI news' }, () =>
      Promise.resolve(
        new Response('x'.repeat(750_001), {
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );

    expect(result.failures[0]?.code).toBe('response-too-large');
  });

  it('reports network failures', async () => {
    const result = await discoverGdelt({ query: 'AI news' }, () =>
      Promise.reject(new Error('offline')),
    );

    expect(result.failures[0]?.code).toBe('provider-fetch-failed');
  });
});
