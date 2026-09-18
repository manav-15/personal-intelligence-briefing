import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  inspectionEvidenceResponseSchema,
  inspectionSearchResponseSchema,
  type StoryCandidate,
} from '../shared/inspection';
import worker from './index';
import { retrieveEvidence } from './evidence';

const env = {
  INSPECTION_ENABLED: 'true',
  SEARXNG_BASE_URL: 'http://localhost:8080',
};
const origin = 'http://localhost:4173';
const story: StoryCandidate = {
  id: 'https://publisher.example/story',
  title: 'New AI release',
  publisher: 'publisher.example',
  publishedAt: null,
  sourceUrl: 'https://publisher.example/story',
  discovery: 'searxng',
  description: {
    text: 'The organization released a new model with a larger context window and updated developer documentation, including examples for deploying applications.',
    kind: 'search-snippet',
    provider: 'searxng',
    observedAt: '2026-09-18T00:00:00Z',
  },
};

function evidenceRequest(
  body: unknown = story,
  requestOrigin = origin,
): Request {
  return new Request(`${origin}/api/inspection/evidence`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: requestOrigin },
    body: JSON.stringify(body),
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('local inspector HTTP interface', () => {
  it('is disabled by default and rejects cross-origin requests when enabled', async () => {
    const fetcher = vi.fn();

    vi.stubGlobal('fetch', fetcher);
    expect((await worker.fetch(evidenceRequest())).status).toBe(404);
    expect(
      (
        await worker.fetch(
          evidenceRequest(story, 'https://untrusted.example'),
          env,
        )
      ).status,
    ).toBe(403);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('validates query and method before contacting providers', async () => {
    const fetcher = vi.fn();

    vi.stubGlobal('fetch', fetcher);
    expect(
      (
        await worker.fetch(
          new Request(`${origin}/api/inspection/search?q=x`),
          env,
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await worker.fetch(
          new Request(`${origin}/api/inspection/search?q=Liverpool`, {
            method: 'POST',
          }),
          env,
        )
      ).status,
    ).toBe(405);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('returns validated search metadata without fetching publisher pages', async () => {
    const fetcher = vi.fn(() =>
      Promise.resolve(
        Response.json({
          results: [
            {
              title: story.title,
              url: story.sourceUrl,
              content: story.description?.text,
              engines: ['brave.news'],
            },
          ],
        }),
      ),
    );

    vi.stubGlobal('fetch', fetcher);
    const response = await worker.fetch(
      new Request(`${origin}/api/inspection/search?q=AI+news`),
      env,
    );
    const data = inspectionSearchResponseSchema.parse(await response.json());

    expect(data.stories).toHaveLength(1);
    expect(data.stories[0]?.description?.kind).toBe('search-snippet');
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });

  it('returns description tier and retains the publisher failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('blocked', { status: 403 }))),
    );
    const response = await worker.fetch(evidenceRequest(), env);
    const data = inspectionEvidenceResponseSchema.parse(await response.json());

    expect(data).toMatchObject({
      tier: 'description',
      evidence: {
        status: 'unavailable',
        reason: 'The publisher returned 403.',
      },
      fallbackDescription: { kind: 'search-snippet' },
    });
  });

  it('rejects repeated-headline metadata as description fallback', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('blocked', { status: 403 }))),
    );
    const response = await worker.fetch(
      evidenceRequest({
        ...story,
        description: { ...story.description, text: story.title.repeat(10) },
      }),
      env,
    );

    expect(
      inspectionEvidenceResponseSchema.parse(await response.json()),
    ).toMatchObject({ tier: 'headline-only', fallbackDescription: null });
  });

  it('rejects navigation descriptions as fallback', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('blocked', { status: 403 }))),
    );
    const response = await worker.fetch(
      evidenceRequest({
        ...story,
        description: {
          ...story.description,
          text: 'Follow this section to personalize your feed and get instant alerts. Update your preferences in Account Settings for personalized content and news.',
        },
      }),
      env,
    );

    expect(
      inspectionEvidenceResponseSchema.parse(await response.json()),
    ).toMatchObject({ tier: 'headline-only', fallbackDescription: null });
  });

  it('prefers article text over a qualified snippet', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response(
            `<title>New AI release</title><article>${'Useful technical detail. '.repeat(40)}</article>`,
            { headers: { 'content-type': 'text/html' } },
          ),
        ),
      ),
    );
    const response = await worker.fetch(evidenceRequest(), env);

    expect(
      inspectionEvidenceResponseSchema.parse(await response.json()),
    ).toMatchObject({
      tier: 'article',
      fallbackDescription: null,
      evidence: {
        status: 'usable',
        pageTitle: 'New AI release',
        extraction: 'article-region',
      },
    });
  });

  it('rejects unsafe schemes and oversized JSON requests before fetching', async () => {
    const fetcher = vi.fn();

    vi.stubGlobal('fetch', fetcher);
    expect(
      (
        await worker.fetch(
          evidenceRequest({ ...story, sourceUrl: 'javascript:alert(1)' }),
          env,
        )
      ).status,
    ).toBe(400);
    expect(
      (await worker.fetch(evidenceRequest({ extra: 'x'.repeat(16001) }), env))
        .status,
    ).toBe(413);
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe('bounded article inspection', () => {
  it('contains broken streams and cancels oversized streams', async () => {
    const broken = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(new Error('broken'));
      },
    });

    expect(
      await retrieveEvidence(story, () =>
        Promise.resolve(
          new Response(broken, { headers: { 'content-type': 'text/html' } }),
        ),
      ),
    ).toMatchObject({
      status: 'unavailable',
      reason: 'The article response could not be read.',
    });
    let cancelled = false;
    const oversized = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(500001));
      },
      cancel() {
        cancelled = true;
      },
    });

    expect(
      await retrieveEvidence(story, () =>
        Promise.resolve(
          new Response(oversized, { headers: { 'content-type': 'text/html' } }),
        ),
      ),
    ).toMatchObject({
      status: 'unavailable',
      reason: 'The publisher page exceeded the size limit.',
    });
    expect(cancelled).toBe(true);
  });

  it('rejects challenge pages and navigation-only text', async () => {
    for (const html of [
      `<title>Just a moment</title><article>${'Useful detail. '.repeat(40)}</article>`,
      `<nav>${'Navigation item. '.repeat(100)}</nav>`,
    ]) {
      const result = await retrieveEvidence(story, () =>
        Promise.resolve(
          new Response(html, { headers: { 'content-type': 'text/html' } }),
        ),
      );

      expect(result.status).toBe('unavailable');
    }
  });

  it.each([
    'http://169.254.169.254/latest',
    'http://100.64.0.1/',
    'http://[::ffff:127.0.0.1]/',
    'https://user:pass@publisher.example/',
  ])('rejects reserved/credential destinations: %s', async (sourceUrl) => {
    const fetcher = vi.fn();

    expect(
      (await retrieveEvidence({ ...story, sourceUrl }, fetcher)).status,
    ).toBe('unavailable');
    expect(fetcher).not.toHaveBeenCalled();
  });
});
