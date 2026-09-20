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

type SearxngResponse = z.infer<typeof responseSchema>;
type SearchInput = z.output<typeof inspectionSearchSchema>;
type DateFilter = { start: Date; end: Date } | null;

/** Queries a configured SearXNG instance and preserves attributed search metadata. */
export async function discoverSearxng(
  request: z.input<typeof inspectionSearchSchema>,
  baseUrl: string,
  fetcher: Fetcher = fetch,
): Promise<DiscoveryResult> {
  const input = inspectionSearchSchema.parse(request);
  const response = await requestSearch(searchUrl(input, baseUrl), fetcher);

  if (isDiscoveryFailure(response)) return response;

  const payload = await parseSearchResponse(response);

  if (isDiscoveryFailure(payload)) return payload;

  return presentSearchResults(payload, input);
}

function searchUrl(input: SearchInput, baseUrl: string): URL {
  const url = new URL('/search', baseUrl);

  if (!['http:', 'https:'].includes(url.protocol))
    throw new Error('Invalid SearXNG configuration.');
  const parameters = new URLSearchParams({
    q: input.query,
    categories: 'news',
    language: 'en',
    format: 'json',
  });

  if (input.timeRange !== 'any') parameters.set('time_range', input.timeRange);

  url.search = parameters.toString();

  return url;
}

async function requestSearch(
  url: URL,
  fetcher: Fetcher,
): Promise<Response | DiscoveryResult> {
  let response: Response;

  try {
    response = await fetcher(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return failed(
      'provider-fetch-failed',
      'Configured SearXNG could not be reached.',
    );
  }

  if (response.ok) return response;

  await response.body?.cancel();

  return failed(
    response.status === 429 ? 'provider-rate-limited' : 'provider-fetch-failed',
    `SearXNG returned ${String(response.status)}.`,
  );
}

async function parseSearchResponse(
  response: Response,
): Promise<SearxngResponse | DiscoveryResult> {
  if (!isJsonResponse(response)) {
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

    return parsed.success
      ? parsed.data
      : failed('invalid-response', 'SearXNG returned an invalid result list.');
  } catch {
    return failed(
      'invalid-response',
      'SearXNG response could not be read as a result list.',
    );
  }
}

function isJsonResponse(response: Response): boolean {
  return (
    response.headers
      .get('content-type')
      ?.toLowerCase()
      .includes('application/json') === true
  );
}

function presentSearchResults(
  payload: SearxngResponse,
  input: SearchInput,
): DiscoveryResult {
  const filter = dateFilter(input.timeRange);
  const candidates = normalizeStories(payload.results);
  const stories = filterStories(candidates, filter);

  return {
    stories: stories.slice(0, input.maxResults),
    ...dateFilterResult(filter, candidates, stories),
    failures: payload.unresponsive_engines.map(([engine, reason]) => ({
      code: 'provider-engine-failed',
      message: `${engine}: ${reason}`,
    })),
  };
}

function dateFilter(timeRange: SearchInput['timeRange']): DateFilter {
  if (timeRange === 'any') return null;

  const end = new Date();
  const days = { day: 1, month: 31, year: 365 };

  return {
    end,
    start: new Date(end.getTime() - days[timeRange] * 86_400_000),
  };
}

function normalizeStories(results: unknown[]): StoryCandidate[] {
  const stories = new Map<string, StoryCandidate>();
  const observedAt = new Date().toISOString();

  for (const value of results) {
    const story = normalizeStory(value, observedAt);

    if (story === undefined) continue;

    const existing = stories.get(story.sourceUrl);

    if (existing === undefined) stories.set(story.sourceUrl, story);
    else mergeEngines(existing, story);
  }

  return [...stories.values()];
}

function normalizeStory(
  value: unknown,
  observedAt: string,
): StoryCandidate | undefined {
  const item = resultSchema.safeParse(value);

  if (!item.success) return undefined;
  const link = new URL(item.data.url);

  if (!isSafeStoryUrl(link)) return undefined;
  link.hash = '';
  const sourceUrl = link.toString();
  const title = plainText(item.data.title).slice(0, 500);

  if (sourceUrl.length > 2_000 || !title) return undefined;
  const publishedAt = publishedDate(item.data.publishedDate);
  const description = plainText(item.data.content ?? '').slice(0, 2_000);

  return {
    id: sourceUrl,
    title,
    publisher: link.hostname,
    sourceUrl,
    discovery: 'searxng',
    publishedAt,
    dateProvenance: publishedAt === null ? 'unknown' : 'search-metadata',
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
}

function isSafeStoryUrl(link: URL): boolean {
  return (
    ['http:', 'https:'].includes(link.protocol) &&
    !link.username &&
    !link.password
  );
}

function publishedDate(value: unknown): string | null {
  const date = typeof value === 'string' ? Date.parse(value) : NaN;

  return Number.isNaN(date) ? null : new Date(date).toISOString();
}

function mergeEngines(existing: StoryCandidate, story: StoryCandidate): void {
  existing.engines = [
    ...new Set([...(existing.engines ?? []), ...(story.engines ?? [])]),
  ];
}

function isDiscoveryFailure(
  value: Response | SearxngResponse | DiscoveryResult,
): value is DiscoveryResult {
  return 'stories' in value;
}

function filterStories(
  candidates: StoryCandidate[],
  filter: DateFilter,
): StoryCandidate[] {
  if (filter === null) return candidates;

  return candidates.filter((story) => {
    if (story.publishedAt === null) return false;
    const date = Date.parse(story.publishedAt);

    return date >= filter.start.getTime() && date <= filter.end.getTime();
  });
}

function dateFilterResult(
  filter: DateFilter,
  candidates: StoryCandidate[],
  stories: StoryCandidate[],
) {
  if (filter === null) return {};

  return {
    dateFilter: {
      from: filter.start.toISOString(),
      to: filter.end.toISOString(),
      excluded: candidates.length - stories.length,
      undated: candidates.filter((story) => story.publishedAt === null).length,
    },
  };
}

function failed(
  code: DiscoveryResult['failures'][number]['code'],
  message: string,
): DiscoveryResult {
  return { stories: [], failures: [{ code, message }] };
}
