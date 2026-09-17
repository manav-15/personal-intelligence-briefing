#!/usr/bin/env node

import process from 'node:process';

const MAX_BYTES = 500_000;
const requestedLimit = Number(process.env.SEARXNG_ARTICLE_LIMIT ?? '6');
const MAX_ARTICLES =
  Number.isInteger(requestedLimit) &&
  requestedLimit >= 1 &&
  requestedLimit <= 10
    ? requestedLimit
    : 6;
const TOPICS = [
  'artificial intelligence',
  'world geopolitics',
  'Liverpool FC Premier League',
];

/** Reads actual streamed bytes within a fixed response limit. */
async function readBounded(response) {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > MAX_BYTES) {
      await reader.cancel();
      throw new Error(`Response exceeded ${MAX_BYTES} bytes.`);
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

/** Checks external article destinations before every fetch and redirect. */
function isPublisherUrl(url) {
  const host = url.hostname;
  return (
    ['http:', 'https:'].includes(url.protocol) &&
    !url.username &&
    !url.password &&
    host !== 'localhost' &&
    !host.endsWith('.localhost') &&
    !host.startsWith('[') &&
    !/^(0\.|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/u.test(
      host,
    ) &&
    host !== 'news.google.com'
  );
}

/** Converts paragraph markup into text for manual evidence inspection. */
function plainText(html) {
  return html
    .replace(/<[^>]+>/gu, ' ')
    .replaceAll('&amp;', '&')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&nbsp;', ' ')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replace(/\s+/gu, ' ')
    .trim();
}

/** Fetches a publisher page, follows bounded redirects, and samples actual paragraphs. */
async function retrieveArticle(result) {
  const hops = [];
  try {
    let url = new URL(result.url);
    const signal = AbortSignal.timeout(15_000);
    for (let count = 0; count <= 5; count += 1) {
      if (!isPublisherUrl(url))
        throw new Error('Not a safe direct publisher URL.');
      const response = await fetch(url, {
        redirect: 'manual',
        signal,
        headers: { accept: 'text/html' },
      });
      hops.push({ url: url.toString(), status: response.status });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        await response.body?.cancel();
        if (!location) throw new Error('Redirect has no destination.');
        url = new URL(location, url);
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error(`Publisher returned HTTP ${response.status}.`);
      }
      if (!response.headers.get('content-type')?.includes('text/html')) {
        await response.body?.cancel();
        throw new Error('Publisher did not return HTML.');
      }
      const html = await readBounded(response);
      const pageTitle = plainText(
        /<title[^>]*>([\s\S]*?)<\/title>/iu.exec(html)?.[1] ?? '',
      );
      if (
        /just a moment|access denied|captcha|verify you are human/iu.test(
          pageTitle,
        )
      ) {
        throw new Error('Publisher returned a challenge page.');
      }
      const content = html.replace(
        /<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1>/giu,
        '',
      );
      const articleBody =
        /<article\b[^>]*>([\s\S]*?)<\/article>/iu.exec(content)?.[1] ?? content;
      const paragraphs = [
        ...articleBody.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/giu),
      ]
        .map((match) => plainText(match[1] ?? ''))
        .filter((text) => text.length >= 80);
      const text = paragraphs.join('\n\n');
      if (text.length < 400)
        throw new Error('Insufficient paragraph text for evidence.');
      return {
        title: result.title,
        engines: result.engines,
        sourceUrl: result.url,
        status: 'retrieved-text-needs-manual-review',
        articleUrl: url.toString(),
        pageTitle,
        characters: text.length,
        paragraphs: paragraphs.length,
        sample: text.slice(0, 1200),
        hops,
      };
    }
    throw new Error('Publisher exceeded five redirects.');
  } catch (error) {
    return {
      title: result.title,
      sourceUrl: result.url,
      status: 'unavailable',
      reason: error instanceof Error ? error.message : String(error),
      hops,
    };
  }
}

/** Runs bounded local searches and retrieves evidence from a capped set of results. */
async function main() {
  const base = process.env.SEARXNG_URL ?? 'http://127.0.0.1:8080';
  const queries =
    process.argv.length > 2 ? [process.argv.slice(2).join(' ')] : TOPICS;
  const reports = [];
  for (const query of queries) {
    const url = new URL('/search', base);
    url.search = new URLSearchParams({
      q: query,
      categories: 'news',
      language: 'en',
      format: 'json',
    }).toString();
    const response = await fetch(url, { signal: AbortSignal.timeout(25_000) });
    if (
      !response.ok ||
      !response.headers.get('content-type')?.includes('application/json')
    ) {
      throw new Error(
        `Local search failed: HTTP ${response.status}; expected JSON.`,
      );
    }
    const data = JSON.parse(await readBounded(response));
    if (!Array.isArray(data.results))
      throw new Error('Local search returned no result array.');
    const results = data.results.filter(
      (result) =>
        typeof result.url === 'string' && typeof result.title === 'string',
    );
    const evidence = [];
    for (const result of results.slice(0, MAX_ARTICLES)) {
      const entry = await retrieveArticle(result);
      evidence.push(entry);
      if (entry.status === 'retrieved-text-needs-manual-review') break;
    }
    reports.push({
      query,
      candidates: results.length,
      unresponsiveEngines: data.unresponsive_engines ?? [],
      evidence,
    });
  }
  console.log(
    JSON.stringify(
      { base, maximumArticlesPerTopic: MAX_ARTICLES, reports },
      null,
      2,
    ),
  );
  if (
    reports.some(
      (report) =>
        !report.evidence.some(
          (entry) => entry.status === 'retrieved-text-needs-manual-review',
        ),
    )
  ) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
