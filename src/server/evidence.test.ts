import { describe, expect, it } from 'vitest';
import { retrieveEvidence } from './evidence';

const story = {
  id: 'https://publisher.example/article',
  title: 'A current story',
  publisher: 'Publisher',
  publishedAt: null,
  sourceUrl: 'https://publisher.example/article',
  discovery: 'searxng' as const,
};

describe('publisher evidence', () => {
  it('prefers JSON-LD datePublished over less structured page dates', async () => {
    const evidence = await retrieveEvidence(story, () =>
      Promise.resolve(
        new Response(
          `<script type="application/ld+json">{"@graph":[{"datePublished":"2026-09-19T06:00:00Z"}]}</script><meta property="article:published_time" content="2026-09-18T06:00:00Z"><article>${'Readable article evidence. '.repeat(30)}</article>`,
          { headers: { 'content-type': 'text/html' } },
        ),
      ),
    );

    expect(evidence).toMatchObject({
      status: 'usable',
      publicationDate: {
        publishedAt: '2026-09-19T06:00:00.000Z',
        provenance: 'publisher-jsonld',
      },
    });
  });

  it('uses recognized metadata when JSON-LD has no publication date', async () => {
    const evidence = await retrieveEvidence(story, () =>
      Promise.resolve(
        new Response(
          `<meta name="parsely-pub-date" content="2026-09-19T05:00:00Z"><article>${'Readable article evidence. '.repeat(30)}</article>`,
          { headers: { 'content-type': 'text/html' } },
        ),
      ),
    );

    expect(evidence).toMatchObject({
      status: 'usable',
      publicationDate: {
        publishedAt: '2026-09-19T05:00:00.000Z',
        provenance: 'publisher-meta',
      },
    });
  });

  it('retains a semantic time date even when the page lacks usable evidence', async () => {
    const evidence = await retrieveEvidence(story, () =>
      Promise.resolve(
        new Response(
          '<time datetime="2026-09-19T04:00:00Z"></time><p>Too short.</p>',
          { headers: { 'content-type': 'text/html' } },
        ),
      ),
    );

    expect(evidence).toEqual({
      status: 'unavailable',
      reason: 'The publisher page did not contain enough readable evidence.',
      publicationDate: {
        publishedAt: '2026-09-19T04:00:00.000Z',
        provenance: 'publisher-time',
      },
    });
  });

  it('fetches a searched publisher link directly and records the final URL', async () => {
    const requested: string[] = [];
    const evidence = await retrieveEvidence(story, (input) => {
      requested.push(inputUrl(input));

      return Promise.resolve(
        new Response(
          `<article>${'Readable article evidence. '.repeat(30)}</article>`,
          {
            headers: { 'content-type': 'text/html' },
          },
        ),
      );
    });

    expect(requested).toEqual(['https://publisher.example/article']);
    expect(evidence).toMatchObject({
      status: 'usable',
      articleUrl: 'https://publisher.example/article',
    });
  });

  it('records the final publisher URL after a safe relative redirect', async () => {
    const evidence = await retrieveEvidence(
      { ...story, sourceUrl: 'https://publisher.example/old' },
      (input) =>
        Promise.resolve(
          inputUrl(input).endsWith('/old')
            ? new Response('', { status: 301, headers: { location: '/new' } })
            : new Response(
                `<article>${'Readable article evidence. '.repeat(30)}</article>`,
                { headers: { 'content-type': 'text/html' } },
              ),
        ),
    );

    expect(evidence).toMatchObject({
      status: 'usable',
      articleUrl: 'https://publisher.example/new',
    });
  });

  it('rejects a publisher redirect to a private address before fetching it', async () => {
    let requests = 0;
    const evidence = await retrieveEvidence(story, () => {
      requests += 1;

      return Promise.resolve(
        new Response('', {
          status: 302,
          headers: { location: 'http://127.0.0.1/private' },
        }),
      );
    });

    expect(requests).toBe(1);
    expect(evidence).toEqual({
      status: 'unavailable',
      reason: 'The publisher link is not safe to fetch.',
    });
  });

  it.each([
    'http://127.0.0.1/article',
    'http://192.168.0.1/article',
    'http://localhost/article',
  ])(
    'rejects the private source URL %s without fetching',
    async (sourceUrl) => {
      let fetched = false;
      const evidence = await retrieveEvidence({ ...story, sourceUrl }, () => {
        fetched = true;

        return Promise.resolve(new Response(''));
      });

      expect(fetched).toBe(false);
      expect(evidence).toEqual({
        status: 'unavailable',
        reason: 'The publisher link is not safe to fetch.',
      });
    },
  );

  it('rejects an aggregator redirect link instead of fetching it as an article', async () => {
    let fetched = false;
    const evidence = await retrieveEvidence(
      {
        ...story,
        id: 'https://news.google.com/rss/articles/one',
        sourceUrl: 'https://news.google.com/rss/articles/one',
      },
      () => {
        fetched = true;

        return Promise.resolve(new Response(''));
      },
    );

    expect(fetched).toBe(false);
    expect(evidence).toEqual({
      status: 'unavailable',
      reason: 'The link is an aggregator redirect, not a publisher page.',
    });
  });

  it('rejects a clearly marked live timeline even when it has readable text', async () => {
    const evidence = await retrieveEvidence(story, () =>
      Promise.resolve(
        new Response(
          `<title>AI model releases timeline — updated daily</title><script type="application/ld+json">{"@type":"CollectionPage","datePublished":"2026-09-19T04:00:00Z"}</script><article>${'Readable page text. '.repeat(30)}</article>`,
          { headers: { 'content-type': 'text/html' } },
        ),
      ),
    );

    expect(evidence).toEqual({
      status: 'unavailable',
      reason:
        'The publisher page is an index or live timeline, not a discrete article.',
      publicationDate: {
        publishedAt: '2026-09-19T04:00:00.000Z',
        provenance: 'publisher-jsonld',
      },
      pageKind: 'index-or-timeline',
    });
  });
});

function inputUrl(input: RequestInfo | URL): string {
  if (input instanceof URL) return input.toString();

  if (typeof input === 'string') return input;

  return input.url;
}
