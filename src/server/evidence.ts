import type { Fetcher, StoryCandidate } from './discovery';
import type { z } from 'zod';
import type { evidenceSchema } from '../shared/inspection';
import { plainText } from './content';
import { readBoundedText } from './http';

type PublisherDate = {
  publishedAt: string;
  provenance: 'publisher-jsonld' | 'publisher-meta' | 'publisher-time';
};

const MAX_ARTICLE_BYTES = 500_000;
const MINIMUM_READABLE_CHARACTERS = 400;
const MAXIMUM_EVIDENCE_CHARACTERS = 12_000;

/** Evidence that can support a substantive briefing claim. */
export type EvidenceResult = z.infer<typeof evidenceSchema>;

/**
 * Resolves a discovery candidate to its publisher page and extracts bounded
 * readable text. It returns an explicit unavailable result for every failure.
 */
export async function retrieveEvidence(
  story: StoryCandidate,
  fetcher: Fetcher = fetch,
): Promise<EvidenceResult> {
  try {
    return await resolveEvidence(story, fetcher);
  } catch {
    return unavailable('The article response could not be read.');
  }
}

async function resolveEvidence(
  story: StoryCandidate,
  fetcher: Fetcher,
): Promise<EvidenceResult> {
  let sourceUrl: URL;

  try {
    sourceUrl = new URL(story.sourceUrl);
  } catch {
    return unavailable('The publisher link is not safe to fetch.');
  }

  // SearXNG hands back publisher links, so an aggregator redirect is never
  // article evidence and must not be fetched as though it were one.
  if (sourceUrl.hostname === 'news.google.com')
    return unavailable(
      'The link is an aggregator redirect, not a publisher page.',
    );

  if (!isFetchablePublisherUrl(sourceUrl))
    return unavailable('The publisher link is not safe to fetch.');

  return retrievePublisherEvidence(sourceUrl, fetcher);
}

async function retrievePublisherEvidence(
  articleUrl: URL,
  fetcher: Fetcher,
): Promise<EvidenceResult> {
  let article: Response;
  const signal = AbortSignal.timeout(10_000);

  for (let redirects = 0; ; redirects += 1) {
    try {
      article = await fetcher(articleUrl, {
        headers: { Accept: 'text/html,application/xhtml+xml' },
        redirect: 'manual',
        signal,
      });
    } catch {
      return unavailable('The publisher page could not be reached.');
    }

    if (article.status < 300 || article.status >= 400) break;
    const location = article.headers.get('location');

    await article.body?.cancel();

    if (!location || redirects >= 5)
      return unavailable('The publisher redirect could not be resolved.');

    try {
      articleUrl = new URL(location, articleUrl);
    } catch {
      return unavailable('The publisher redirect was invalid.');
    }

    if (!isFetchablePublisherUrl(articleUrl))
      return unavailable('The publisher link is not safe to fetch.');
  }

  if (!article.ok) {
    await article.body?.cancel();

    return unavailable(`The publisher returned ${String(article.status)}.`);
  }

  if (
    !article.headers.get('content-type')?.toLowerCase().includes('text/html')
  ) {
    await article.body?.cancel();

    return unavailable('The publisher response was not an HTML article.');
  }

  const html = await readBoundedText(article, MAX_ARTICLE_BYTES);

  if (html === null)
    return unavailable('The publisher page exceeded the size limit.');

  return extractPublisherEvidence(articleUrl, html);
}

function extractPublisherEvidence(
  articleUrl: URL,
  html: string,
): EvidenceResult {
  const publicationDate = extractPublicationDate(html);
  const pageTitle = plainText(
    /<title[^>]*>([\s\S]*?)<\/title>/iu.exec(html)?.[1] ?? '',
  );

  if (
    /just a moment|access denied|captcha|verify you are human/iu.test(pageTitle)
  ) {
    return unavailable('The publisher returned a challenge page.');
  }

  if (isIndexOrTimelinePage(html, pageTitle, articleUrl)) {
    return unavailable(
      'The publisher page is an index or live timeline, not a discrete article.',
      publicationDate,
      'index-or-timeline',
    );
  }
  const { text, extraction } = extractReadableText(html);

  if (text.length < MINIMUM_READABLE_CHARACTERS) {
    return unavailable(
      'The publisher page did not contain enough readable evidence.',
      publicationDate,
    );
  }

  return {
    status: 'usable',
    articleUrl: articleUrl.toString(),
    text: text.slice(0, MAXIMUM_EVIDENCE_CHARACTERS),
    truncated: text.length > MAXIMUM_EVIDENCE_CHARACTERS,
    provenance: 'publisher-page',
    pageTitle,
    extraction,
    publicationDate,
  };
}

function unavailable(
  reason: string,
  publicationDate?: PublisherDate,
  pageKind?: 'index-or-timeline',
): EvidenceResult {
  return { status: 'unavailable', reason, publicationDate, pageKind };
}

function isIndexOrTimelinePage(
  html: string,
  pageTitle: string,
  articleUrl: URL,
): boolean {
  const indexPath =
    /\/(?:tag|tags|topic|topics|category|categories|search)(?:\/|$)/iu.test(
      articleUrl.pathname,
    );
  const timelineTitle =
    /\b(?:live(?:\s+(?:blog|updates?|coverage))?|timeline|updated daily)\b/iu.test(
      pageTitle,
    );

  return indexPath || timelineTitle || hasIndexJsonLdType(html);
}

function hasIndexJsonLdType(html: string): boolean {
  const indexTypes = new Set([
    'CollectionPage',
    'ItemList',
    'SearchResultsPage',
    'LiveBlogPosting',
  ]);
  const scripts = html.match(
    /<script\b[^>]*\btype=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/giu,
  );

  for (const script of scripts ?? []) {
    const text = script.replace(/^.*?>/su, '').replace(/<\/script>$/iu, '');

    try {
      if (jsonLdTypes(JSON.parse(text)).some((type) => indexTypes.has(type)))
        return true;
    } catch {
      // Invalid structured data is untrusted and cannot classify a page.
    }
  }

  return false;
}

function jsonLdTypes(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(jsonLdTypes);

  if (value === null || typeof value !== 'object') return [];
  const record = value as Record<string, unknown>;
  const type = record['@type'];
  const ownTypes = Array.isArray(type)
    ? type.filter((item): item is string => typeof item === 'string')
    : typeof type === 'string'
      ? [type]
      : [];

  return [...ownTypes, ...jsonLdTypes(record['@graph'])];
}

function extractPublicationDate(html: string): PublisherDate | undefined {
  return (
    jsonLdPublicationDate(html) ??
    metaPublicationDate(html) ??
    timeElementPublicationDate(html)
  );
}

function jsonLdPublicationDate(html: string): PublisherDate | undefined {
  const scripts = html.match(
    /<script\b[^>]*\btype=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/giu,
  );

  for (const script of scripts ?? []) {
    const text = script.replace(/^.*?>/su, '').replace(/<\/script>$/iu, '');

    try {
      const date = firstJsonLdDate(JSON.parse(text));

      if (date !== undefined)
        return { publishedAt: date, provenance: 'publisher-jsonld' };
    } catch {
      // Invalid structured data is untrusted and cannot recover freshness.
    }
  }
}

function firstJsonLdDate(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    for (const item of value) {
      const date = firstJsonLdDate(item);

      if (date !== undefined) return date;
    }

    return undefined;
  }

  if (value === null || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  const date = normalizedDate(record.datePublished);

  if (date !== undefined) return date;

  return firstJsonLdDate(record['@graph']);
}

function metaPublicationDate(html: string): PublisherDate | undefined {
  const dateNames = new Set([
    'article:published_time',
    'date',
    'datepublished',
    'parsely-pub-date',
    'dc.date',
    'publish-date',
    'pub_date',
  ]);
  const tags = html.match(/<meta\b[^>]*>/giu) ?? [];

  for (const tag of tags) {
    const name =
      attribute(tag, 'property') ??
      attribute(tag, 'name') ??
      attribute(tag, 'itemprop');
    const date = normalizedDate(attribute(tag, 'content'));

    if (
      name !== undefined &&
      date !== undefined &&
      dateNames.has(name.toLowerCase())
    )
      return { publishedAt: date, provenance: 'publisher-meta' };
  }
}

function timeElementPublicationDate(html: string): PublisherDate | undefined {
  for (const tag of html.match(/<time\b[^>]*>/giu) ?? []) {
    const date = normalizedDate(attribute(tag, 'datetime'));

    if (date !== undefined)
      return { publishedAt: date, provenance: 'publisher-time' };
  }
}

function attribute(tag: string, name: string): string | undefined {
  return new RegExp(`\\b${name}=["']([^"']+)["']`, 'iu').exec(tag)?.[1];
}

function normalizedDate(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.trim() === '') return undefined;
  const timestamp = Date.parse(value);

  return Number.isFinite(timestamp)
    ? new Date(timestamp).toISOString()
    : undefined;
}

function isFetchablePublisherUrl(url: URL): boolean {
  if (!['http:', 'https:'].includes(url.protocol)) return false;

  if (url.username || url.password) return false;
  const hostname = url.hostname.toLowerCase();

  // Conservatively reject literal IPv6 until a complete address policy is introduced.
  if (hostname.startsWith('[')) return false;

  if (isForbiddenIpv4Address(hostname)) return false;

  return !isPrivateHostname(hostname);
}

function isForbiddenIpv4Address(hostname: string): boolean {
  if (!/^\d+\.\d+\.\d+\.\d+$/u.test(hostname)) return false;

  const [first = 0, second = 0] = hostname.split('.').map(Number);

  return [
    first === 0 || first === 10 || first === 127 || first >= 224,
    (first === 100 && second >= 64 && second <= 127) ||
      (first === 169 && second === 254) ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && [0, 2, 168].includes(second)) ||
      (first === 198 && [18, 19, 51].includes(second)) ||
      (first === 203 && second === 0),
  ].some(Boolean);
}

function isPrivateHostname(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal') ||
    /^127\./.test(hostname) ||
    hostname === '::1' ||
    hostname === '[::1]' ||
    /^10\./.test(hostname) ||
    /^192\.168\./.test(hostname) ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname)
  );
}

function extractReadableText(html: string): {
  text: string;
  extraction: 'article-region' | 'paragraphs';
} {
  const cleaned = html.replace(
    /<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1>/giu,
    '',
  );
  const article = /<article\b[^>]*>([\s\S]*?)<\/article>/iu.exec(cleaned)?.[1];

  if (article !== undefined)
    return { text: plainText(article), extraction: 'article-region' };
  const region =
    /<main\b[^>]*>([\s\S]*?)<\/main>/iu.exec(cleaned)?.[1] ?? cleaned;
  const paragraphs = [...region.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/giu)]
    .map((match) => plainText(match[1] ?? ''))
    .filter((text) => text.length >= 80);

  return { text: paragraphs.join('\n\n'), extraction: 'paragraphs' };
}
