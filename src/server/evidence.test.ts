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
