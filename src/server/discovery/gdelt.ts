import { z } from 'zod';
import type {
  DiscoveryFailure,
  DiscoveryResult,
  Fetcher,
  StoryCandidate,
} from './types';

const MAX_RESPONSE_BYTES = 750_000;
const requestSchema = z.object({
  query: z.string().trim().min(2).max(200),
  maxResults: z.number().int().min(1).max(25).default(10),
});
const responseSchema = z.object({ articles: z.array(z.unknown()) });
const articleSchema = z.object({
  url: z.url(),
  title: z.string().trim().min(1),
  language: z.string(),
});

/** Builds a bounded, English-language GDELT article-list query for the past week. */
export function gdeltSearchUrl(request: z.input<typeof requestSchema>): URL {
  const input = requestSchema.parse(request);
  const url = new URL('https://api.gdeltproject.org/api/v2/doc/doc');
  url.search = new URLSearchParams({
    query: `${input.query} sourcelang:english`,
    mode: 'artlist',
    format: 'json',
    maxrecords: String(input.maxResults),
    timespan: '1week',
    sort: 'datedesc',
  }).toString();
  return url;
}

/** Queries GDELT once, validates external JSON, and returns direct publisher leads. */
export async function discoverGdelt(
  request: z.input<typeof requestSchema>,
  fetcher: Fetcher = fetch,
): Promise<DiscoveryResult> {
  const input = requestSchema.parse(request);
  let response: Response;
  try {
    response = await fetcher(gdeltSearchUrl(input), {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return failure('provider-fetch-failed', 'GDELT could not be reached.');
  }

  if (!response.ok) {
    await response.body?.cancel();
    return failure(
      response.status === 429
        ? 'provider-rate-limited'
        : 'provider-fetch-failed',
      `GDELT returned ${String(response.status)}.`,
    );
  }
  if (
    !response.headers
      .get('content-type')
      ?.toLowerCase()
      .includes('application/json')
  ) {
    await response.body?.cancel();
    return failure('invalid-response', 'GDELT did not return JSON.');
  }

  try {
    const text = await readResponse(response);
    if (text === null) {
      return failure(
        'response-too-large',
        'GDELT response exceeded the size limit.',
      );
    }
    const parsed = responseSchema.safeParse(JSON.parse(text) as unknown);
    if (!parsed.success) {
      return failure(
        'invalid-response',
        'GDELT returned an invalid article list.',
      );
    }

    const stories = new Map<string, StoryCandidate>();
    for (const article of parsed.data.articles) {
      const candidate = normalizeArticle(article);
      if (candidate !== null && !stories.has(candidate.id)) {
        stories.set(candidate.id, candidate);
      }
      if (stories.size >= input.maxResults) break;
    }
    return { stories: [...stories.values()], failures: [] };
  } catch {
    return failure(
      'invalid-response',
      'GDELT response could not be read as an article list.',
    );
  }
}

function normalizeArticle(value: unknown): StoryCandidate | null {
  const parsed = articleSchema.safeParse(value);
  if (!parsed.success || parsed.data.language.toLowerCase() !== 'english')
    return null;
  const url = new URL(parsed.data.url);
  if (
    !['https:', 'http:'].includes(url.protocol) ||
    url.username ||
    url.password
  )
    return null;
  url.hash = '';
  const sourceUrl = url.toString();
  return {
    id: sourceUrl,
    title: parsed.data.title,
    publisher: url.hostname,
    // GDELT seendate is the indexing time, not a verified publication timestamp.
    publishedAt: null,
    sourceUrl,
    discovery: 'gdelt',
  };
}

function failure(
  code: DiscoveryFailure['code'],
  message: string,
): DiscoveryResult {
  return { stories: [], failures: [{ code, message }] };
}

async function readResponse(response: Response): Promise<string | null> {
  const declaredLength = Number(response.headers.get('content-length'));
  if (declaredLength > MAX_RESPONSE_BYTES) {
    await response.body?.cancel();
    return null;
  }
  if (!response.body) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      return null;
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}
