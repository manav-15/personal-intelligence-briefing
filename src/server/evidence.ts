import type { Fetcher, StoryCandidate } from './discovery';

const MAX_ARTICLE_BYTES = 500_000;
const MINIMUM_READABLE_CHARACTERS = 400;
const MAXIMUM_EVIDENCE_CHARACTERS = 12_000;

/** Evidence that can support a substantive briefing claim. */
export type EvidenceResult =
  | {
      status: 'usable';
      articleUrl: string;
      text: string;
      truncated: boolean;
      provenance: 'publisher-page';
    }
  | { status: 'unavailable'; reason: string };

/**
 * Resolves a discovery candidate to its publisher page and extracts bounded
 * readable text. It returns an explicit unavailable result for every failure.
 */
export async function retrieveEvidence(
  story: StoryCandidate,
  fetcher: Fetcher = fetch,
): Promise<EvidenceResult> {
  let sourceUrl: URL;
  try {
    sourceUrl = new URL(story.sourceUrl);
  } catch {
    return unavailable('The publisher link is not safe to fetch.');
  }
  if (story.discovery === 'gdelt') {
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
  if (!article.ok)
    return unavailable(`The publisher returned ${String(article.status)}.`);
  if (
    !article.headers.get('content-type')?.toLowerCase().includes('text/html')
  ) {
    return unavailable('The publisher response was not an HTML article.');
  }

  const html = await readText(article, MAX_ARTICLE_BYTES);
  if (!html.ok)
    return unavailable('The publisher page exceeded the size limit.');
  const text = extractReadableText(html.value);
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
  };
}

function unavailable(reason: string): EvidenceResult {
  return { status: 'unavailable', reason };
}

function isFetchablePublisherUrl(url: URL): boolean {
  if (!['http:', 'https:'].includes(url.protocol)) return false;
  if (url.username || url.password) return false;
  const hostname = url.hostname.toLowerCase();
  return !(
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    /^127\./.test(hostname) ||
    hostname === '::1' ||
    hostname === '[::1]' ||
    /^10\./.test(hostname) ||
    /^192\.168\./.test(hostname) ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname)
  );
}

function extractReadableText(html: string): string {
  return decodeHtml(
    html
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim(),
  );
}

function decodeHtml(value: string): string {
  return value
    .replaceAll('&nbsp;', ' ')
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'");
}

async function readText(
  response: Response,
  maximumBytes: number,
): Promise<{ ok: true; value: string } | { ok: false }> {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes)
    return { ok: false };
  const content = await response.arrayBuffer();
  if (content.byteLength > maximumBytes) return { ok: false };
  return { ok: true, value: new TextDecoder().decode(content) };
}
