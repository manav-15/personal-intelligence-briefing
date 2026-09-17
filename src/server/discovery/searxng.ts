import { z } from 'zod';
import { inspectionSearchSchema } from '../../shared/inspection';
import { plainText } from '../content';
import { readBoundedText } from '../http';
import type { DiscoveryResult, Fetcher, StoryCandidate } from './types';

const responseSchema = z.object({
  results: z.array(z.unknown()),
  unresponsive_engines: z.array(z.tuple([z.string(), z.string()])).default([]),
});
const resultSchema = z.object({
  title: z.string().trim().min(1),
  url: z.url(),
  content: z.string().nullable().optional(),
  engines: z.array(z.string()).default([]),
  publishedDate: z.unknown().optional(),
});

/** Queries a configured SearXNG instance and preserves attributed search metadata. */
export async function discoverSearxng(
  request: z.input<typeof inspectionSearchSchema>,
  baseUrl: string,
  fetcher: Fetcher = fetch,
): Promise<DiscoveryResult> {
  const input = inspectionSearchSchema.parse(request);
  const url = new URL('/search', baseUrl);
  if (!['http:', 'https:'].includes(url.protocol))
    throw new Error('Invalid SearXNG configuration.');
  url.search = new URLSearchParams({
    q: input.query,
    categories: 'news',
    language: 'en',
    format: 'json',
  }).toString();
  // Native time filters skip the other news engines; filter returned dates locally.
  const end = new Date();
  const days = { day: 1, month: 31, year: 365 };
  const start =
    input.timeRange === 'any'
      ? null
      : new Date(end.getTime() - days[input.timeRange] * 86_400_000);
  let response: Response;
  try {
    response = await fetcher(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return failed(
      'provider-fetch-failed',
      'Local SearXNG could not be reached. Run npm run searxng:start.',
    );
  }
  if (!response.ok) {
    await response.body?.cancel();
    return failed(
      response.status === 429
        ? 'provider-rate-limited'
        : 'provider-fetch-failed',
      `SearXNG returned ${String(response.status)}.`,
    );
  }
  if (
    !response.headers
      .get('content-type')
      ?.toLowerCase()
      .includes('application/json')
  ) {
    await response.body?.cancel();
    return failed(
      'invalid-response',
      'SearXNG did not return JSON. Enable its JSON format.',
    );
  }
  try {
    const text = await readBoundedText(response, 750_000);
    if (text === null)
      return failed(
        'response-too-large',
        'SearXNG response exceeded the size limit.',
      );
    const parsed = responseSchema.safeParse(JSON.parse(text) as unknown);
    if (!parsed.success)
      return failed(
        'invalid-response',
        'SearXNG returned an invalid result list.',
      );
    const observedAt = new Date().toISOString();
    const stories = new Map<string, StoryCandidate>();
    for (const value of parsed.data.results) {
      const item = resultSchema.safeParse(value);
      if (!item.success) continue;
      const link = new URL(item.data.url);
      if (
        !['http:', 'https:'].includes(link.protocol) ||
        link.username ||
        link.password
      )
        continue;
      link.hash = '';
      const sourceUrl = link.toString();
      if (sourceUrl.length > 2000) continue;
      const title = plainText(item.data.title).slice(0, 500);
      if (!title) continue;
      const date =
        typeof item.data.publishedDate === 'string'
          ? Date.parse(item.data.publishedDate)
          : NaN;
      const description = plainText(item.data.content ?? '').slice(0, 2000);
      const story: StoryCandidate = {
        id: sourceUrl,
        title,
        publisher: link.hostname,
        sourceUrl,
        discovery: 'searxng',
        publishedAt: Number.isNaN(date) ? null : new Date(date).toISOString(),
        dateProvenance: Number.isNaN(date) ? 'unknown' : 'search-metadata',
        engines: item.data.engines,
        ...(description
          ? {
              description: {
                text: description,
                kind: 'search-snippet',
                provider: 'searxng',
                observedAt,
              },
            }
          : {}),
      };
      const existing = stories.get(sourceUrl);
      if (existing)
        existing.engines = [
          ...new Set([...(existing.engines ?? []), ...item.data.engines]),
        ];
      else stories.set(sourceUrl, story);
    }
    const candidates = [...stories.values()];
    const eligible =
      start === null
        ? candidates
        : candidates.filter((story) => {
            if (story.publishedAt === null) return false;
            const date = Date.parse(story.publishedAt);
            return date >= start.getTime() && date <= end.getTime();
          });
    return {
      stories: eligible.slice(0, input.maxResults),
      ...(start === null
        ? {}
        : {
            dateFilter: {
              from: start.toISOString(),
              to: end.toISOString(),
              excluded: candidates.length - eligible.length,
              undated: candidates.filter((story) => story.publishedAt === null)
                .length,
            },
          }),
      failures: parsed.data.unresponsive_engines.map(([engine, reason]) => ({
        code: 'provider-engine-failed',
        message: `${engine}: ${reason}`,
      })),
    };
  } catch {
    return failed(
      'invalid-response',
      'SearXNG response could not be read as a result list.',
    );
  }
}

function failed(
  code: DiscoveryResult['failures'][number]['code'],
  message: string,
): DiscoveryResult {
  return { stories: [], failures: [{ code, message }] };
}
