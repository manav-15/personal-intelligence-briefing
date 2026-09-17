import type { z } from 'zod';
import type { healthSchema } from '../shared/health';
import { discoverGdelt, discoverGoogleNews } from './discovery';
import { retrieveEvidence } from './evidence';

/**
 * Worker HTTP entrypoint. Static Assets serve the application; this handler
 * owns first-party API routes that must never fall through to the SPA.
 */
export default {
  /** Returns the versioned health contract or a JSON error for unsupported routes. */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/api/health') {
      if (request.method !== 'GET') {
        return Response.json(
          { error: 'Method not allowed' },
          { status: 405, headers: { Allow: 'GET' } },
        );
      }

      const health: z.infer<typeof healthSchema> = { status: 'ok' };
      return Response.json(health, {
        headers: { 'Cache-Control': 'no-store' },
      });
    }

    if (url.pathname === '/api/feasibility/discovery') {
      if (request.method !== 'GET') {
        return Response.json(
          { error: 'Method not allowed' },
          { status: 405, headers: { Allow: 'GET' } },
        );
      }

      return runDiscoveryFeasibility(url);
    }

    return Response.json({ error: 'Not found' }, { status: 404 });
  },
} satisfies ExportedHandler;

async function runDiscoveryFeasibility(url: URL): Promise<Response> {
  const query = url.searchParams.get('q') ?? 'artificial intelligence';
  const maxResults = parseResultLimit(url.searchParams.get('limit'));
  const provider = url.searchParams.get('provider') ?? 'google-news';
  if (provider !== 'google-news' && provider !== 'gdelt') {
    return Response.json(
      { error: 'Unknown discovery provider. Use google-news or gdelt.' },
      { status: 400 },
    );
  }

  try {
    const discover = provider === 'gdelt' ? discoverGdelt : discoverGoogleNews;
    const discovery = await discover({ query, maxResults });
    const evidence = await Promise.all(
      discovery.stories.map(async (story) => ({
        title: story.title,
        publisher: story.publisher,
        sourceUrl: story.sourceUrl,
        evidence: await retrieveEvidence(story),
      })),
    );

    return Response.json(
      {
        query,
        provider,
        candidates: discovery.stories.length,
        failures: discovery.failures,
        evidence: evidence.map((entry) => ({
          title: entry.title,
          publisher: entry.publisher,
          sourceUrl: entry.sourceUrl,
          status: entry.evidence.status,
          articleUrl:
            entry.evidence.status === 'usable'
              ? entry.evidence.articleUrl
              : null,
          reason:
            entry.evidence.status === 'unavailable'
              ? entry.evidence.reason
              : null,
          characters:
            entry.evidence.status === 'usable' ? entry.evidence.text.length : 0,
        })),
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch {
    return Response.json(
      { error: 'Invalid feasibility query. Use 2–200 characters.' },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}

function parseResultLimit(value: string | null): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 5 ? parsed : 5;
}
