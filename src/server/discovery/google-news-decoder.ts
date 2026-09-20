import { readBoundedText } from '../http';
import type { Fetcher } from './types';

const GOOGLE_NEWS_HOST = 'news.google.com';
const MAX_DECODER_PAGE_BYTES = 1_000_000;
const MAX_DECODER_RESPONSE_BYTES = 200_000;

/** A bounded, attributable result from Google's undocumented publisher-link decoder. */
export type GoogleNewsDecodeResult =
  { ok: true; publisherUrl: string } | { ok: false; message: string };

/**
 * Resolves one Google News RSS article URL to its publisher URL.
 *
 * Google does not document this protocol. The adapter performs no retries,
 * CAPTCHA workarounds, or redirect-based article retrieval.
 */
export async function decodeGoogleNewsPublisherUrl(
  sourceUrl: string,
  fetcher: Fetcher = fetch,
): Promise<GoogleNewsDecodeResult> {
  const articleId = googleArticleId(sourceUrl);

  if (articleId === null)
    return {
      ok: false,
      message: 'Google News link had no supported article ID.',
    };

  const parameters = await decoderParameters(articleId, fetcher);

  if (!parameters.ok) return parameters;

  return callGoogleDecoder(articleId, parameters, fetcher);
}

/** Extracts an opaque article identifier only from the supported Google RSS URL shape. */
export function googleArticleId(sourceUrl: string): string | null {
  try {
    const url = new URL(sourceUrl);
    const parts = url.pathname.split('/').filter(Boolean);
    const articleId = parts.at(-1);

    if (
      url.protocol !== 'https:' ||
      url.hostname !== GOOGLE_NEWS_HOST ||
      parts.length !== 3 ||
      parts[0] !== 'rss' ||
      parts[1] !== 'articles' ||
      articleId === undefined ||
      articleId.length > 2_000
    )
      return null;

    return articleId;
  } catch {
    return null;
  }
}

async function decoderParameters(
  articleId: string,
  fetcher: Fetcher,
): Promise<
  | { ok: true; signature: string; timestamp: string }
  | { ok: false; message: string }
> {
  let response: Response;

  try {
    response = await fetcher(
      `https://${GOOGLE_NEWS_HOST}/rss/articles/${encodeURIComponent(articleId)}`,
      {
        headers: { Accept: 'text/html' },
        signal: AbortSignal.timeout(10_000),
      },
    );
  } catch {
    return {
      ok: false,
      message: 'Google News decoder parameters could not be fetched.',
    };
  }

  const html = await readBoundedText(response, MAX_DECODER_PAGE_BYTES);

  if (!response.ok || html === null)
    return {
      ok: false,
      message: `Google News decoder parameters were unavailable (HTTP ${String(response.status)}).`,
    };

  if (/captcha|unusual traffic|sorry\.google/iu.test(html))
    return {
      ok: false,
      message: 'Google News challenged publisher-link decoding.',
    };

  const signature = /data-n-a-sg="([^"]+)"/u.exec(html)?.[1];
  const timestamp = /data-n-a-ts="([^"]+)"/u.exec(html)?.[1];

  if (signature === undefined || timestamp === undefined)
    return {
      ok: false,
      message: 'Google News decoder parameters were missing.',
    };

  return { ok: true, signature, timestamp };
}

async function callGoogleDecoder(
  articleId: string,
  parameters: { signature: string; timestamp: string },
  fetcher: Fetcher,
): Promise<GoogleNewsDecodeResult> {
  const decoderRequest = [
    'garturlreq',
    [
      [
        'X',
        'X',
        ['X', 'X'],
        null,
        null,
        1,
        1,
        'US:en',
        null,
        1,
        null,
        null,
        null,
        null,
        null,
        0,
        1,
      ],
      'X',
      'X',
      1,
      [1, 1, 1],
      1,
      1,
      null,
      0,
      0,
      null,
      0,
    ],
    articleId,
    parameters.timestamp,
    parameters.signature,
  ];
  const request = ['Fbv4je', JSON.stringify(decoderRequest)];
  const body = new URLSearchParams({ 'f.req': JSON.stringify([[request]]) });
  let response: Response;

  try {
    response = await fetcher(
      `https://${GOOGLE_NEWS_HOST}/_/DotsSplashUi/data/batchexecute`,
      {
        body,
        headers: {
          'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
          origin: `https://${GOOGLE_NEWS_HOST}`,
          referer: `https://${GOOGLE_NEWS_HOST}/`,
        },
        method: 'POST',
        signal: AbortSignal.timeout(10_000),
      },
    );
  } catch {
    return {
      ok: false,
      message: 'Google News publisher-link decoder could not be reached.',
    };
  }

  const payload = await readBoundedText(response, MAX_DECODER_RESPONSE_BYTES);

  if (!response.ok || payload === null)
    return {
      ok: false,
      message: `Google News publisher-link decoder failed (HTTP ${String(response.status)}).`,
    };

  const publisherUrl = decodedPublisherUrl(payload);

  return publisherUrl === null
    ? {
        ok: false,
        message: 'Google News publisher-link decoder returned no URL.',
      }
    : { ok: true, publisherUrl };
}

/** Reads the encoded result string from one batchexecute record, when it is a decoder record. */
function decoderRowResult(value: unknown): string | null {
  if (!Array.isArray(value)) return null;

  const cells = value as unknown[];
  const operation = cells[1];
  const encoded = cells[2];

  return operation === 'Fbv4je' && typeof encoded === 'string' ? encoded : null;
}
/** Validates one decoded Google result as an external publisher URL. */
function decodedResultUrl(value: unknown): string | null {
  if (!Array.isArray(value)) return null;

  const candidate = (value as unknown[])[1];

  if (typeof candidate !== 'string') return null;
  const url = new URL(candidate);

  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.hostname === GOOGLE_NEWS_HOST ||
    url.username ||
    url.password
  )
    return null;

  return url.toString();
}

/** Extracts one validated external URL from Google's nested batchexecute envelope. */
export function decodedPublisherUrl(payload: string): string | null {
  const json = payload.split('\n\n')[1];

  if (json === undefined) return null;

  try {
    const rows: unknown = JSON.parse(json);

    if (!Array.isArray(rows)) return null;

    for (const row of rows) {
      const encoded = decoderRowResult(row);

      if (encoded === null) continue;
      const url = decodedResultUrl(JSON.parse(encoded) as unknown);

      if (url !== null) return url;
    }
  } catch {
    return null;
  }

  return null;
}
