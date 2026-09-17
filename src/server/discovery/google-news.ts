import { z } from 'zod';
import type {
  DiscoveryFailure,
  DiscoveryResult,
  Fetcher,
  StoryCandidate,
} from './types';

const GOOGLE_NEWS_HOST = 'news.google.com';
const MAX_FEED_BYTES = 750_000;

const discoveryRequestSchema = z.object({
  query: z.string().trim().min(2).max(200),
  locale: z
    .string()
    .regex(/^[a-z]{2}-[A-Z]{2}$/)
    .default('en-IN'),
  country: z
    .string()
    .regex(/^[A-Z]{2}$/)
    .default('IN'),
  maxResults: z.number().int().min(1).max(25).default(10),
});

/**
 * Queries Google News RSS, validates its untrusted XML, and returns a bounded,
 * deduplicated set of stories. It intentionally retains Google News links until
 * the evidence module resolves the publisher URL.
 */
export async function discoverGoogleNews(
  request: z.input<typeof discoveryRequestSchema>,
  fetcher: Fetcher = fetch,
): Promise<DiscoveryResult> {
  const input = discoveryRequestSchema.parse(request);
  const url = googleNewsSearchUrl(input);

  let response: Response;
  try {
    response = await fetcher(url, {
      headers: { Accept: 'application/rss+xml, application/xml, text/xml' },
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return failure('feed-fetch-failed', 'Google News could not be reached.');
  }

  if (!response.ok) {
    return failure(
      'feed-fetch-failed',
      `Google News returned ${String(response.status)}.`,
    );
  }

  const xml = await readText(response, MAX_FEED_BYTES);
  if (!xml.ok)
    return failure(
      'feed-too-large',
      'Google News response exceeded the size limit.',
    );

  const stories = parseRssItems(xml.value)
    .map(normalizeItem)
    .filter((story): story is StoryCandidate => story !== null);

  if (stories.length === 0 && !xml.value.includes('<rss')) {
    return failure(
      'invalid-feed',
      'Google News returned an unreadable RSS feed.',
    );
  }

  return {
    stories: deduplicate(stories).slice(0, input.maxResults),
    failures: [],
  };
}

/** Builds a locale-specific Google News RSS URL from validated search input. */
export function googleNewsSearchUrl(
  input: z.infer<typeof discoveryRequestSchema>,
): URL {
  const ceid = `${input.country}:${input.locale.slice(0, 2)}`;
  return new URL(
    `/rss/search?${new URLSearchParams({
      q: input.query,
      hl: input.locale,
      gl: input.country,
      ceid,
    })}`,
    `https://${GOOGLE_NEWS_HOST}`,
  );
}

function failure(
  code: DiscoveryFailure['code'],
  message: string,
): DiscoveryResult {
  return { stories: [], failures: [{ code, message }] };
}

function parseRssItems(xml: string): Array<Record<string, string>> {
  return [...xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)].map((match) => {
    const item = match[1] ?? '';
    return {
      title: readTag(item, 'title'),
      link: readTag(item, 'link'),
      source: readTag(item, 'source'),
      pubDate: readTag(item, 'pubDate'),
    };
  });
}

function normalizeItem(item: Record<string, string>): StoryCandidate | null {
  const title = decodeXml(item.title ?? '').trim();
  const sourceUrl = normalizeGoogleNewsUrl(decodeXml(item.link ?? '').trim());
  if (!title || !sourceUrl) return null;

  const parsedDate = Date.parse(decodeXml(item.pubDate ?? ''));
  return {
    id: sourceUrl,
    title,
    publisher: emptyToNull(decodeXml(item.source ?? '').trim()),
    publishedAt: Number.isNaN(parsedDate)
      ? null
      : new Date(parsedDate).toISOString(),
    sourceUrl,
    discovery: 'google-news',
  };
}

function normalizeGoogleNewsUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.hostname !== GOOGLE_NEWS_HOST)
      return null;
    url.searchParams.delete('oc');
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

function deduplicate(stories: StoryCandidate[]): StoryCandidate[] {
  return [...new Map(stories.map((story) => [story.id, story])).values()];
}

function readTag(xml: string, name: string): string {
  const match = new RegExp(
    `<${name}\\b[^>]*>([\\s\\S]*?)<\\/${name}>`,
    'i',
  ).exec(xml);
  return match?.[1]?.replace(/^<!\[CDATA\[([\s\S]*)\]\]>$/, '$1') ?? '';
}

function decodeXml(value: string): string {
  return value
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'");
}

function emptyToNull(value: string): string | null {
  return value || null;
}

async function readText(
  response: Response,
  maximumBytes: number,
): Promise<{ ok: true; value: string } | { ok: false }> {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes)
    return { ok: false };

  if (!response.body) return { ok: true, value: '' };
  const reader = response.body.getReader();

  const chunks: Uint8Array[] = [];
  let bytesRead = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytesRead += value.byteLength;
    if (bytesRead > maximumBytes) {
      await reader.cancel();
      return { ok: false };
    }
    chunks.push(value);
  }

  const combined = new Uint8Array(bytesRead);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, value: new TextDecoder().decode(combined) };
}
