import { Hono, type Context } from 'hono';
import { inspectionSearchSchema } from '../../shared/inspection';
import { discoverSearxng } from '../discovery';
import { retrieveEvidence } from '../evidence';
import {
  allowMethods,
  diagnosticEnabled,
  noStore,
  requireIdentity,
  sameOrigin,
  type HttpEnv,
} from './policy';

/**
 * Local-only probe for the one real discovery provider: it searches the
 * configured SearXNG instance and reports the evidence outcome of each lead.
 * It is hidden before identity, origin, method, or input validation.
 */
export const feasibilityRoutes = new Hono<HttpEnv>();
feasibilityRoutes.use(
  '*',
  noStore,
  diagnosticEnabled('INSPECTION_ENABLED', 'Local feasibility is disabled.'),
  requireIdentity,
  sameOrigin('Cross-origin feasibility access is not allowed.'),
);
feasibilityRoutes.all('/discovery', allowMethods('GET'));
feasibilityRoutes.get('/discovery', discoveryHandler);

async function discoveryHandler(c: Context<HttpEnv>): Promise<Response> {
  const url = new URL(c.req.url);
  const input = inspectionSearchSchema.safeParse({
    query: url.searchParams.get('q') ?? 'artificial intelligence',
    maxResults: Number(url.searchParams.get('limit') ?? '5'),
    timeRange: 'any',
  });

  if (!input.success)
    return c.json(
      { error: 'Invalid feasibility query. Use 2–200 characters.' },
      400,
    );

  c.header('Cache-Control', 'no-store');

  try {
    const discovery = await discoverSearxng(
      input.data,
      c.env.SEARXNG_BASE_URL ?? 'http://127.0.0.1:8080',
    );
    const evidence = await Promise.all(
      discovery.stories.map(async (story) => ({
        title: story.title,
        publisher: story.publisher,
        sourceUrl: story.sourceUrl,
        evidence: await retrieveEvidence(story),
      })),
    );

    return c.json(
      {
        query: input.data.query,
        provider: 'searxng',
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
      200,
    );
  } catch {
    return c.json({ error: 'Local SearXNG configuration is invalid.' }, 503);
  }
}
