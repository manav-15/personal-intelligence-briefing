import { Hono, type Context } from 'hono';
import {
  inspectionSearchSchema,
  storyCandidateSchema,
} from '../../shared/inspection';
import { hasInformativeDescription } from '../content';
import { discoverSearxng } from '../discovery';
import { retrieveEvidence } from '../evidence';
import { readBoundedText } from '../http';
import {
  allowMethods,
  diagnosticEnabled,
  sameOrigin,
  noStore,
  type HttpEnv,
} from './policy';

/** Opt-in local search and bounded article inspection HTTP routes. */
export const inspectionRoutes = new Hono<HttpEnv>();
// The original prefix includes a trailing slash; the bare mount has no diagnostic policy.
inspectionRoutes.use('*', async (c, next) => {
  if (new URL(c.req.url).pathname === '/api/inspection')
    return c.json({ error: 'Not found' }, 404);
  await next();
});
inspectionRoutes.use(
  '*',
  noStore,
  diagnosticEnabled('INSPECTION_ENABLED', 'Local inspection is disabled.'),
  sameOrigin('Cross-origin inspection is not allowed.'),
);
inspectionRoutes.all('/search', allowMethods('GET'));
inspectionRoutes.get('/search', searchHandler);
inspectionRoutes.all('/evidence', allowMethods('POST'));
inspectionRoutes.post('/evidence', evidenceHandler);

async function searchHandler(c: Context<HttpEnv>): Promise<Response> {
  const url = new URL(c.req.url);
  const input = inspectionSearchSchema.safeParse({
    query: url.searchParams.get('q'),
    maxResults: Number(url.searchParams.get('limit') ?? '10'),
    timeRange: url.searchParams.get('timeRange') ?? 'any',
  });

  if (!input.success)
    return c.json(
      {
        error:
          'Use a 2–200 character query, 1–15 results, and a supported time range.',
      },
      400,
    );

  try {
    const discovery = await discoverSearxng(
      input.data,
      c.env.SEARXNG_BASE_URL ?? 'http://127.0.0.1:8080',
    );

    return c.json({
      ...discovery,
      query: input.data.query,
      timeRange: input.data.timeRange,
      observedAt: new Date().toISOString(),
    });
  } catch {
    return c.json({ error: 'Local SearXNG configuration is invalid.' }, 503);
  }
}

async function evidenceHandler(c: Context<HttpEnv>): Promise<Response> {
  const request = c.req.raw;
  const url = new URL(request.url);
  const origin = request.headers.get('origin');

  if (origin !== url.origin)
    return c.json(
      { error: 'Evidence requests require a same-origin Origin header.' },
      403,
    );

  if (!request.headers.get('content-type')?.includes('application/json'))
    return c.json({ error: 'Expected a JSON story.' }, 415);
  let value: unknown;

  try {
    const text = await readBoundedText(request, 16_000);

    if (text === null)
      return c.json({ error: 'Story request exceeded the size limit.' }, 413);
    value = JSON.parse(text) as unknown;
  } catch {
    return c.json({ error: 'Could not read the JSON story.' }, 400);
  }
  const parsed = storyCandidateSchema.safeParse(value);

  if (!parsed.success) return c.json({ error: 'Invalid story metadata.' }, 400);
  const evidence = await retrieveEvidence(parsed.data);
  const description = parsed.data.description;
  const qualified =
    description !== undefined &&
    hasInformativeDescription(parsed.data.title, description.text);

  return c.json({
    evidence,
    tier:
      evidence.status === 'usable'
        ? 'article'
        : qualified
          ? 'description'
          : 'headline-only',
    fallbackDescription:
      evidence.status === 'unavailable' && qualified ? description : null,
  });
}
