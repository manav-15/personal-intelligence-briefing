import {
  inspectionSearchSchema,
  storyCandidateSchema,
} from '../shared/inspection';
import { hasInformativeDescription } from './content';
import { discoverSearxng } from './discovery';
import { retrieveEvidence } from './evidence';
import { readBoundedText } from './http';

/** Local diagnostic bindings; leave inspection disabled in deployed environments. */
export type InspectionEnv = {
  INSPECTION_ENABLED?: string;
  SEARXNG_BASE_URL?: string;
};

/** Handles opt-in local search and on-demand article inspection routes. */
export async function handleInspection(
  request: Request,
  env: InspectionEnv,
): Promise<Response> {
  if (env.INSPECTION_ENABLED !== 'true')
    return json({ error: 'Local inspection is disabled.' }, 404);
  const url = new URL(request.url);
  const origin = request.headers.get('origin');
  if (
    (origin !== null && origin !== url.origin) ||
    request.headers.get('sec-fetch-site') === 'cross-site'
  ) {
    return json({ error: 'Cross-origin inspection is not allowed.' }, 403);
  }
  if (url.pathname === '/api/inspection/search') {
    if (request.method !== 'GET') return methodNotAllowed('GET');
    const input = inspectionSearchSchema.safeParse({
      query: url.searchParams.get('q'),
      maxResults: Number(url.searchParams.get('limit') ?? '10'),
      timeRange: url.searchParams.get('timeRange') ?? 'any',
    });
    if (!input.success)
      return json(
        {
          error:
            'Use a 2–200 character query, 1–15 results, and a supported time range.',
        },
        400,
      );
    try {
      const discovery = await discoverSearxng(
        input.data,
        env.SEARXNG_BASE_URL ?? 'http://127.0.0.1:8080',
      );
      return json({
        ...discovery,
        query: input.data.query,
        timeRange: input.data.timeRange,
        observedAt: new Date().toISOString(),
      });
    } catch {
      return json({ error: 'Local SearXNG configuration is invalid.' }, 503);
    }
  }
  if (url.pathname === '/api/inspection/evidence') {
    if (request.method !== 'POST') return methodNotAllowed('POST');
    if (origin !== url.origin)
      return json(
        { error: 'Evidence requests require a same-origin Origin header.' },
        403,
      );
    if (!request.headers.get('content-type')?.includes('application/json'))
      return json({ error: 'Expected a JSON story.' }, 415);
    let value: unknown;
    try {
      const text = await readBoundedText(request, 16_000);
      if (text === null)
        return json({ error: 'Story request exceeded the size limit.' }, 413);
      value = JSON.parse(text) as unknown;
    } catch {
      return json({ error: 'Could not read the JSON story.' }, 400);
    }
    const parsed = storyCandidateSchema.safeParse(value);
    if (!parsed.success) return json({ error: 'Invalid story metadata.' }, 400);
    const evidence = await retrieveEvidence(parsed.data);
    const description = parsed.data.description;
    const qualified =
      description !== undefined &&
      hasInformativeDescription(parsed.data.title, description.text);
    return json({
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
  return json({ error: 'Not found' }, 404);
}

function json(value: unknown, status = 200): Response {
  return Response.json(value, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}

function methodNotAllowed(method: string): Response {
  return Response.json(
    { error: 'Method not allowed' },
    { status: 405, headers: { Allow: method, 'Cache-Control': 'no-store' } },
  );
}
