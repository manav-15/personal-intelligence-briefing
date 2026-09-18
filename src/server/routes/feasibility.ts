import { Hono, type Context } from 'hono';
import { discoverGdelt, discoverGoogleNews } from '../discovery';
import { retrieveEvidence } from '../evidence';
import { allowMethods, type HttpEnv } from './policy';

/** Existing discovery probe; provider and evidence behavior remains in domain modules. */
export const feasibilityRoutes = new Hono<HttpEnv>();
feasibilityRoutes.all('/discovery', allowMethods('GET'));
feasibilityRoutes.get('/discovery', discoveryHandler);

async function discoveryHandler(c: Context<HttpEnv>): Promise<Response> {
  const url = new URL(c.req.url);
  const query = url.searchParams.get('q') ?? 'artificial intelligence';
  const maxResults = parseResultLimit(url.searchParams.get('limit'));
  const provider = url.searchParams.get('provider') ?? 'google-news';

  if (provider !== 'google-news' && provider !== 'gdelt') {
    return c.json(
      { error: 'Unknown discovery provider. Use google-news or gdelt.' },
      400,
    );
  }

  c.header('Cache-Control', 'no-store');

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

    return c.json(
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
      200,
    );
  } catch {
    return c.json(
      { error: 'Invalid feasibility query. Use 2–200 characters.' },
      400,
    );
  }
}

function parseResultLimit(value: string | null): number {
  const parsed = Number(value);

  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 5 ? parsed : 5;
}
