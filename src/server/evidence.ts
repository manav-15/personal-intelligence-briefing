import type { Fetcher, StoryCandidate } from './discovery';
import type { z } from 'zod';
import type { evidenceSchema } from '../shared/inspection';
import { plainText } from './content';
import { readBoundedText } from './http';

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
  if (sourceUrl.hostname !== 'news.google.com') {
    if (!isFetchablePublisherUrl(sourceUrl))
      return unavailable('The publisher link is not safe to fetch.');
    return retrievePublisherEvidence(sourceUrl, fetcher);
  }
  let redirect: Response;
  try {
    redirect = await fetcher(story.sourceUrl, {
      redirect: 'manual',
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return unavailable('The Google News link could not be resolved.');
  }

  const location = redirect.headers.get('location');
  await redirect.body?.cancel();
  if (!location)
    return unavailable('Google News did not provide a publisher link.');

  let articleUrl: URL;
  try {
    articleUrl = new URL(location, story.sourceUrl);
  } catch {
    return unavailable('Google News returned an invalid publisher link.');
  }
  if (articleUrl.hostname === 'news.google.com') {
    return unavailable(
      'Google News requires an additional publisher-link decoder before article retrieval.',
    );
  }
  if (!isFetchablePublisherUrl(articleUrl))
    return unavailable('The publisher link is not safe to fetch.');

  return retrievePublisherEvidence(articleUrl, fetcher);
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
  const pageTitle = plainText(
    /<title[^>]*>([\s\S]*?)<\/title>/iu.exec(html)?.[1] ?? '',
  );
  if (
    /just a moment|access denied|captcha|verify you are human/iu.test(pageTitle)
  ) {
    return unavailable('The publisher returned a challenge page.');
  }
  const { text, extraction } = extractReadableText(html);
  if (text.length < MINIMUM_READABLE_CHARACTERS) {
    return unavailable(
      'The publisher page did not contain enough readable evidence.',
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
  };
}

function unavailable(reason: string): EvidenceResult {
  return { status: 'unavailable', reason };
}

function isFetchablePublisherUrl(url: URL): boolean {
  if (!['http:', 'https:'].includes(url.protocol)) return false;
  if (url.username || url.password) return false;
  const hostname = url.hostname.toLowerCase();
  // Conservatively reject literal IPv6 until a complete address policy is introduced.
  if (hostname.startsWith('[')) return false;
  if (/^\d+\.\d+\.\d+\.\d+$/u.test(hostname)) {
    const [first = 0, second = 0] = hostname.split('.').map(Number);
    if (
      first === 0 ||
      first === 10 ||
      first === 127 ||
      first >= 224 ||
      (first === 100 && second >= 64 && second <= 127) ||
      (first === 169 && second === 254) ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && [0, 2, 168].includes(second)) ||
      (first === 198 && [18, 19, 51].includes(second)) ||
      (first === 203 && second === 0)
    )
      return false;
  }
  return !(
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
