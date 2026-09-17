#!/usr/bin/env node

import process from 'node:process';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const USER_AGENT =
  'Mozilla/5.0 (compatible; PersonalBriefingSearchVerifier/0.1; +https://example.invalid)';
const execFileAsync = promisify(execFile);

/** Reads a JSON response with a bounded payload for repeatable diagnostics. */
async function fetchJson(url) {
  let response;
  let text;

  try {
    response = await fetch(url, {
      headers: { accept: 'application/json', 'user-agent': USER_AGENT },
    });
    text = await response.text();
  } catch {
    const result = await execFileAsync('curl', [
      '--fail',
      '--silent',
      '--show-error',
      '--max-time',
      '20',
      '--header',
      'accept: application/json',
      '--header',
      `user-agent: ${USER_AGENT}`,
      url.toString(),
    ]);
    text = result.stdout;
    return {
      contentType: 'application/json (curl fallback)',
      data: JSON.parse(text),
      preview: null,
      status: 200,
    };
  }

  const bytes = new TextEncoder().encode(text).byteLength;

  if (bytes > 1_000_000) {
    throw new Error(
      `Response from ${url.origin} exceeded the 1000000-byte diagnostic limit.`,
    );
  }

  const contentType = response.headers.get('content-type');
  if (contentType?.includes('application/json') !== true) {
    return {
      contentType,
      data: null,
      preview: text.slice(0, 120),
      status: response.status,
    };
  }

  return {
    contentType,
    data: JSON.parse(text),
    preview: null,
    status: response.status,
  };
}

/** Queries GDELT's public article list API, whose result records contain publisher URLs. */
async function verifyGdelt(query) {
  const url = new URL('https://api.gdeltproject.org/api/v2/doc/doc');
  url.search = new URLSearchParams({
    format: 'json',
    maxrecords: '3',
    mode: 'artlist',
    query,
    sort: 'datedesc',
    timespan: '1week',
  }).toString();

  const result = await fetchJson(url);
  if (result.data === null) {
    return {
      endpoint: url.toString(),
      outcome: 'unusable: expected JSON but received another representation',
      response: {
        contentType: result.contentType,
        preview: result.preview,
        status: result.status,
      },
    };
  }

  const articles = Array.isArray(result.data.articles)
    ? result.data.articles
    : [];
  return {
    directPublisherUrls: articles.map((article) => ({
      domain: article.domain,
      title: article.title,
      url: article.url,
    })),
    endpoint: url.toString(),
    response: { contentType: result.contentType, status: result.status },
  };
}

/** Tests a SearXNG instance's advertised JSON endpoint without treating HTML as success. */
async function verifySearxng(query) {
  const base = process.env.SEARXNG_URL ?? 'https://searx.be';
  const url = new URL('/search', base);
  url.search = new URLSearchParams({
    categories: 'news',
    format: 'json',
    q: query,
  }).toString();
  const response = await fetch(url, {
    headers: { accept: 'application/json', 'user-agent': USER_AGENT },
  });
  const text = await response.text();
  const contentType = response.headers.get('content-type');

  if (contentType?.includes('application/json') !== true) {
    return {
      endpoint: url.toString(),
      outcome: 'unusable: expected JSON but received another representation',
      response: {
        contentType,
        preview: text.slice(0, 120),
        status: response.status,
      },
    };
  }

  const data = JSON.parse(text);
  const results = Array.isArray(data.results) ? data.results : [];
  return {
    directPublisherUrls: results
      .slice(0, 3)
      .map((result) => ({ title: result.title, url: result.url })),
    endpoint: url.toString(),
    outcome:
      'usable only when this instance enables JSON and its upstream engines return stable results',
    response: { contentType, status: response.status },
  };
}

/** Runs the configured free-provider probes and keeps failures isolated by source. */
async function main() {
  const query = process.argv.slice(2).join(' ') || 'artificial intelligence';
  const checks = await Promise.allSettled([
    verifyGdelt(query),
    verifySearxng(query),
  ]);
  const sources = ['gdelt', 'searxng'].map((source, index) => {
    const check = checks[index];
    if (check?.status === 'fulfilled') {
      return { source, ...check.value };
    }

    return {
      error:
        check?.reason instanceof Error
          ? check.reason.message
          : String(check?.reason),
      source,
    };
  });

  console.log(JSON.stringify({ query, sources }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
