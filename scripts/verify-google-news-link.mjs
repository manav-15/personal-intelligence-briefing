#!/usr/bin/env node

import process from 'node:process';

const GOOGLE_NEWS_HOST = 'news.google.com';
const MAX_REDIRECTS = 10;
const USER_AGENT =
  'Mozilla/5.0 (compatible; PersonalBriefingLinkVerifier/0.1; +https://example.invalid)';

/** Escapes a string so it is safe to use as a regular-expression literal. */
function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

/** Returns the first CDATA or XML-text value for an RSS field. */
function readRssField(item, field) {
  const name = escapeRegex(field);
  const cdata = new RegExp(
    `<${name}><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${name}>`,
    'u',
  ).exec(item);
  const text = new RegExp(`<${name}>([\\s\\S]*?)<\\/${name}>`, 'u').exec(item);
  const value = cdata?.[1] ?? text?.[1];

  return value?.trim() ?? null;
}

/** Decodes the XML entities used in Google News RSS titles and links. */
function decodeXml(value) {
  return value
    .replaceAll('&amp;', '&')
    .replaceAll('&quot;', '"')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&#39;', "'");
}

/** Reads a bounded set of article records from a Google News RSS search feed. */
function parseRss(xml, limit) {
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gu)]
    .slice(0, limit)
    .flatMap((match) => {
      const item = match[1];
      if (item === undefined) {
        return [];
      }

      const link = readRssField(item, 'link');
      const title = readRssField(item, 'title');
      if (link === null || title === null) {
        return [];
      }

      return [{ link: decodeXml(link), title: decodeXml(title) }];
    });
}

/** Extracts Google News' opaque article identifier from an RSS article link. */
function readGoogleArticleId(urlText) {
  const url = new URL(urlText);
  const parts = url.pathname.split('/').filter(Boolean);
  const id = parts.at(-1);

  if (url.hostname !== GOOGLE_NEWS_HOST || id === undefined) {
    throw new Error('The RSS item is not a Google News article URL.');
  }

  return id;
}

/** Reads a response body and fails before unbounded diagnostic data is retained. */
async function readBoundedText(response, maximumBytes) {
  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength > maximumBytes) {
    throw new Error(
      `Response exceeded the ${maximumBytes}-byte diagnostic limit.`,
    );
  }

  return text;
}

/** Fetches the per-article parameters used by Google's undocumented decoder. */
async function getDecoderParameters(articleId) {
  const response = await fetch(
    `https://${GOOGLE_NEWS_HOST}/rss/articles/${articleId}`,
    {
      headers: { 'user-agent': USER_AGENT },
    },
  );
  const html = await readBoundedText(response, 1_000_000);
  const signature = /data-n-a-sg="([^"]+)"/u.exec(html)?.[1];
  const timestamp = /data-n-a-ts="([^"]+)"/u.exec(html)?.[1];

  if (!response.ok || signature === undefined || timestamp === undefined) {
    throw new Error(
      `Google decoder parameters unavailable (HTTP ${response.status}; signature=${String(signature !== undefined)}; timestamp=${String(timestamp !== undefined)}).`,
    );
  }

  return { signature, timestamp };
}

/** Finds the publisher URL inside Google's nested batchexecute response. */
function extractDecodedUrl(payload) {
  const chunks = payload.split('\n\n');
  const json = chunks[1];
  if (json === undefined) {
    throw new Error('Google decoder returned no JSON response chunk.');
  }

  const rows = JSON.parse(json);
  if (!Array.isArray(rows)) {
    throw new Error('Google decoder JSON root was not an array.');
  }

  for (const row of rows) {
    if (
      !Array.isArray(row) ||
      (row[0] !== 'wrb.fr' && row[0] !== 'w779db') ||
      row[1] !== 'Fbv4je'
    ) {
      continue;
    }

    const encodedResult = row[2];
    if (typeof encodedResult !== 'string') {
      continue;
    }

    const result = JSON.parse(encodedResult);
    const url = result[1];
    if (typeof url === 'string' && /^https?:\/\//u.test(url)) {
      return url;
    }
  }

  throw new Error('Google decoder response contained no publisher URL.');
}

/** Calls Google's undocumented decoder endpoint for one opaque article identifier. */
async function decodeGoogleArticleUrl(articleId, parameters) {
  const request = [
    'Fbv4je',
    `["garturlreq",[["X","X",["X","X"],null,null,1,1,"US:en",null,1,null,null,null,null,null,0,1],"X","X",1,[1,1,1],1,1,null,0,0,null,0],"${articleId}",${parameters.timestamp},"${parameters.signature}"]`,
  ];
  const body = new URLSearchParams({ 'f.req': JSON.stringify([[request]]) });
  const response = await fetch(
    `https://${GOOGLE_NEWS_HOST}/_/DotsSplashUi/data/batchexecute`,
    {
      body,
      headers: {
        'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
        origin: `https://${GOOGLE_NEWS_HOST}`,
        referer: `https://${GOOGLE_NEWS_HOST}/`,
        'user-agent': USER_AGENT,
      },
      method: 'POST',
    },
  );
  const payload = await readBoundedText(response, 1_000_000);

  if (!response.ok) {
    throw new Error(`Google decoder returned HTTP ${response.status}.`);
  }

  return extractDecodedUrl(payload);
}

/** Follows HTTP redirects without downloading an article body. */
async function traceRedirects(initialUrl) {
  const hops = [];
  let currentUrl = initialUrl;

  for (let count = 0; count <= MAX_REDIRECTS; count += 1) {
    const response = await fetch(currentUrl, {
      headers: { 'user-agent': USER_AGENT },
      redirect: 'manual',
    });
    const location = response.headers.get('location');
    hops.push({
      contentType: response.headers.get('content-type'),
      location,
      status: response.status,
      url: currentUrl,
    });
    await response.body?.cancel();

    if (location === null || response.status < 300 || response.status >= 400) {
      return hops;
    }

    currentUrl = new URL(location, currentUrl).toString();
  }

  throw new Error(`More than ${MAX_REDIRECTS} redirects.`);
}

/** Parses the supported command-line options for this verification script. */
function readArguments(args) {
  const query = args[0] ?? 'artificial intelligence';
  const requestedLimit = Number(args[1] ?? '1');
  const limit =
    Number.isInteger(requestedLimit) &&
    requestedLimit >= 1 &&
    requestedLimit <= 5
      ? requestedLimit
      : 1;

  return { limit, query };
}

/** Runs the Google RSS-to-publisher-link experiment and prints JSON evidence. */
async function main() {
  const { limit, query } = readArguments(process.argv.slice(2));
  const feedUrl = new URL('https://news.google.com/rss/search');
  feedUrl.searchParams.set('q', query);
  feedUrl.searchParams.set('hl', 'en-IN');
  feedUrl.searchParams.set('gl', 'IN');
  feedUrl.searchParams.set('ceid', 'IN:en');

  const feedResponse = await fetch(feedUrl, {
    headers: { 'user-agent': USER_AGENT },
  });
  const feedXml = await readBoundedText(feedResponse, 1_000_000);
  if (!feedResponse.ok) {
    throw new Error(`Google News RSS returned HTTP ${feedResponse.status}.`);
  }

  const stories = parseRss(feedXml, limit);
  const results = [];
  for (const story of stories) {
    try {
      const articleId = readGoogleArticleId(story.link);
      const parameters = await getDecoderParameters(articleId);
      const publisherUrl = await decodeGoogleArticleUrl(articleId, parameters);
      results.push({
        decoder: 'undocumented Google batchexecute protocol',
        googleRssUrl: story.link,
        publisherRedirectTrace: await traceRedirects(publisherUrl),
        publisherUrl,
        title: story.title,
      });
    } catch (error) {
      results.push({
        error: error instanceof Error ? error.message : String(error),
        googleRssUrl: story.link,
        title: story.title,
      });
    }
  }

  console.log(
    JSON.stringify({ feedUrl: feedUrl.toString(), results }, null, 2),
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
