import { describe, expect, it } from 'vitest';
import {
  discoverGoogleNews,
  googleNewsSearchUrl,
  type Fetcher,
} from './discovery';
import { retrieveEvidence } from './evidence';

const feed = `<?xml version="1.0"?><rss><channel>
  <item><title><![CDATA[AI model release]]></title><link>https://news.google.com/rss/articles/one?oc=5</link><source>Example AI</source><pubDate>Tue, 16 Sep 2026 08:00:00 GMT</pubDate></item>
  <item><title>AI model release</title><link>https://news.google.com/rss/articles/one?oc=5</link><source>Example AI</source><pubDate>Tue, 16 Sep 2026 08:00:00 GMT</pubDate></item>
  <item><title>World diplomacy update</title><link>https://news.google.com/rss/articles/two</link><source>Example World</source><pubDate>not a date</pubDate></item>
</channel></rss>`;

function response(body: string, init?: ResponseInit): Response {
  return new Response(body, init);
}

describe('Google News discovery', () => {
  it('builds a locale-specific RSS query', () => {
    expect(
      googleNewsSearchUrl({
        query: 'Liverpool FC',
        locale: 'en-IN',
        country: 'IN',
        maxResults: 5,
      }).toString(),
    ).toBe(
      'https://news.google.com/rss/search?q=Liverpool+FC&hl=en-IN&gl=IN&ceid=IN%3Aen',
    );
  });

  it('normalizes and deduplicates valid feed items', async () => {
    const fetcher: Fetcher = () =>
      Promise.resolve(response(feed, { status: 200 }));
    const result = await discoverGoogleNews(
      { query: 'artificial intelligence', maxResults: 5 },
      fetcher,
    );

    expect(result.failures).toEqual([]);
    expect(result.stories).toHaveLength(2);
    expect(result.stories[0]).toMatchObject({
      title: 'AI model release',
      publisher: 'Example AI',
    });
    expect(result.stories[0]?.sourceUrl).not.toContain('oc=5');
    expect(result.stories[1]?.publishedAt).toBeNull();
  });

  it('returns a recoverable failure for malformed provider output', async () => {
    const result = await discoverGoogleNews({ query: 'geopolitics' }, () =>
      Promise.resolve(response('not XML')),
    );

    expect(result).toMatchObject({
      stories: [],
      failures: [{ code: 'invalid-feed' }],
    });
  });
});

describe('bounded evidence retrieval', () => {
  const story = {
    id: 'https://news.google.com/rss/articles/one',
    title: 'AI model release',
    publisher: 'Example AI',
    publishedAt: null,
    sourceUrl: 'https://news.google.com/rss/articles/one',
    discovery: 'google-news' as const,
  };

  it('fetches GDELT publisher links directly without Google resolution', async () => {
    const urls: string[] = [];
    const result = await retrieveEvidence(
      {
        ...story,
        sourceUrl: 'https://publisher.example/article',
        discovery: 'gdelt',
      },
      (input) => {
        urls.push(requestUrl(input));

        return Promise.resolve(
          response(`<article>${'Useful evidence. '.repeat(40)}</article>`, {
            headers: { 'content-type': 'text/html' },
          }),
        );
      },
    );

    expect(urls).toEqual(['https://publisher.example/article']);
    expect(result).toMatchObject({
      status: 'usable',
      articleUrl: 'https://publisher.example/article',
    });
  });

  it('rejects unsafe GDELT publisher URLs before fetching', async () => {
    let fetched = false;
    const result = await retrieveEvidence(
      { ...story, sourceUrl: 'http://127.0.0.1/article', discovery: 'gdelt' },
      () => {
        fetched = true;

        return Promise.resolve(response(''));
      },
    );

    expect(fetched).toBe(false);
    expect(result.status).toBe('unavailable');
  });

  it('validates publisher redirects before fetching the destination', async () => {
    let requests = 0;
    const result = await retrieveEvidence(
      {
        ...story,
        sourceUrl: 'https://publisher.example/article',
        discovery: 'gdelt',
      },
      () => {
        requests += 1;

        return Promise.resolve(
          response('', {
            status: 302,
            headers: { location: 'http://127.0.0.1/private' },
          }),
        );
      },
    );

    expect(requests).toBe(1);
    expect(result).toMatchObject({
      status: 'unavailable',
      reason: 'The publisher link is not safe to fetch.',
    });
  });

  it('records the final publisher URL after a safe relative redirect', async () => {
    const result = await retrieveEvidence(
      {
        ...story,
        sourceUrl: 'https://publisher.example/old',
        discovery: 'gdelt',
      },
      (input) =>
        Promise.resolve(
          requestUrl(input).endsWith('/old')
            ? response('', { status: 301, headers: { location: '/new' } })
            : response(`<article>${'Useful evidence. '.repeat(40)}</article>`, {
                headers: { 'content-type': 'text/html' },
              }),
        ),
    );

    expect(result).toMatchObject({
      status: 'usable',
      articleUrl: 'https://publisher.example/new',
    });
  });

  it('resolves a publisher page and extracts readable text', async () => {
    const article = `<html><script>ignore()</script><body><article>${'A useful detail. '.repeat(40)}</article></body></html>`;
    const fetcher: Fetcher = (input) => {
      const url = requestUrl(input);

      return Promise.resolve(
        url.includes('news.google.com')
          ? response('', {
              status: 302,
              headers: { location: 'https://publisher.example/article' },
            })
          : response(article, { headers: { 'content-type': 'text/html' } }),
      );
    };

    await expect(retrieveEvidence(story, fetcher)).resolves.toMatchObject({
      status: 'usable',
      articleUrl: 'https://publisher.example/article',
      provenance: 'publisher-page',
    });
  });

  it('does not treat a missing redirect as evidence', async () => {
    await expect(
      retrieveEvidence(story, () =>
        Promise.resolve(response('', { status: 200 })),
      ),
    ).resolves.toEqual({
      status: 'unavailable',
      reason: 'Google News did not provide a publisher link.',
    });
  });

  it('reports Google News nested redirects as unresolved evidence', async () => {
    await expect(
      retrieveEvidence(story, () =>
        Promise.resolve(
          response('', {
            status: 302,
            headers: {
              location: 'https://news.google.com/rss/articles/with-locale',
            },
          }),
        ),
      ),
    ).resolves.toEqual({
      status: 'unavailable',
      reason:
        'Google News returned another Google link instead of a publisher URL.',
    });
  });

  it('rejects private publisher URLs', async () => {
    await expect(
      retrieveEvidence(story, () =>
        Promise.resolve(
          response('', {
            status: 302,
            headers: { location: 'http://127.0.0.1/' },
          }),
        ),
      ),
    ).resolves.toMatchObject({
      status: 'unavailable',
      reason: 'The publisher link is not safe to fetch.',
    });
  });
});

function requestUrl(input: RequestInfo | URL): string {
  if (input instanceof URL) return input.toString();

  if (typeof input === 'string') return input;

  return input.url;
}
