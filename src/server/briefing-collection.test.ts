import { describe, expect, it } from 'vitest';
import { examplePreferences } from '../shared/preferences';
import {
  collectBriefingCandidates,
  defaultBriefingCollectionBudget,
} from './briefing-collection';
import type { Fetcher } from './discovery';

const feed = `<?xml version="1.0"?><rss><channel>
  <item><title>AI model release</title><link>https://news.google.com/rss/articles/example</link><source>Example AI</source><pubDate>Fri, 18 Sep 2026 08:00:00 GMT</pubDate></item>
</channel></rss>`;

describe('briefing candidate collection', () => {
  it('deduplicates exact discovery URLs across topics and retains temporary article evidence', async () => {
    const ai = examplePreferences.topics[0];
    const world = examplePreferences.topics[1];

    if (ai === undefined || world === undefined)
      throw new Error('Example preferences need AI and world topics.');
    const preferences = {
      ...examplePreferences,
      topics: [
        { ...ai, searchConcepts: [] },
        {
          ...world,
          id: 'ai-policy',
          interests: ['Artificial intelligence'],
          searchConcepts: [],
        },
      ],
    };
    const result = await collectBriefingCandidates(
      {
        runId: 'ad7fb1a7-9d5d-4cbe-a571-c8e3a0d0f0ee',
        preferenceRevision: preferences.revision,
        preferences,
        budget: defaultBriefingCollectionBudget,
      },
      fixtureFetcher,
    );

    expect(result.failures).toEqual([]);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({
      topicIds: ['ai', 'ai-policy'],
      evidenceTier: 'article',
      evidence: {
        status: 'usable',
        articleUrl: 'https://publisher.example/article',
      },
    });
  });

  it('uses configured private SearXNG discovery before fallback providers', async () => {
    const calls: string[] = [];
    const result = await collectBriefingCandidates(
      {
        runId: 'ad7fb1a7-9d5d-4cbe-a571-c8e3a0d0f0ee',
        preferenceRevision: examplePreferences.revision,
        preferences: examplePreferences,
        budget: { ...defaultBriefingCollectionBudget, maxQueries: 1 },
      },
      fixtureFetcher,
      {
        searxng: {
          baseUrl: 'http://searxng.test',
          fetcher: (input, init) => {
            calls.push(
              new URL(input instanceof Request ? input.url : input).hostname,
            );

            return fixtureFetcher(input, init);
          },
        },
      },
    );

    expect(calls).toEqual(['searxng.test']);
    expect(result.failures).toContainEqual({
      stage: 'budget',
      provider: null,
      message: 'Discovery stopped after reaching the query budget.',
    });
  });

  it('retains fallback results when a configured provider throws', async () => {
    const result = await collectBriefingCandidates(
      {
        runId: 'ad7fb1a7-9d5d-4cbe-a571-c8e3a0d0f0ee',
        preferenceRevision: examplePreferences.revision,
        preferences: examplePreferences,
        budget: { ...defaultBriefingCollectionBudget, maxQueries: 3 },
      },
      fixtureFetcher,
      {
        searxng: { baseUrl: 'not a URL', fetcher: fixtureFetcher },
      },
    );

    expect(result.candidates).toHaveLength(1);
    expect(result.failures).toContainEqual(
      expect.objectContaining({ stage: 'discovery', provider: 'searxng' }),
    );
  });

  it('reports an explicit budget failure without exceeding evidence retrieval', async () => {
    const result = await collectBriefingCandidates(
      {
        runId: 'ad7fb1a7-9d5d-4cbe-a571-c8e3a0d0f0ee',
        preferenceRevision: examplePreferences.revision,
        preferences: examplePreferences,
        budget: {
          ...defaultBriefingCollectionBudget,
          maxQueries: 1,
          maxEvidenceFetches: 1,
        },
      },
      fixtureFetcher,
    );

    expect(result.candidates).toHaveLength(1);
    expect(result.failures).toContainEqual({
      stage: 'budget',
      provider: null,
      message: 'Discovery stopped after reaching the query budget.',
    });
  });
});

const fixtureFetcher: Fetcher = (input) => {
  const url = new URL(
    input instanceof URL
      ? input.toString()
      : typeof input === 'string'
        ? input
        : input.url,
  );

  if (url.hostname === 'news.google.com' && url.pathname === '/rss/search') {
    return Promise.resolve(
      new Response(feed, {
        headers: { 'content-type': 'application/rss+xml' },
      }),
    );
  }

  if (url.hostname === 'news.google.com') {
    return Promise.resolve(
      new Response('', {
        status: 302,
        headers: { location: 'https://publisher.example/article' },
      }),
    );
  }

  if (url.hostname === 'api.gdeltproject.org') {
    return Promise.resolve(
      Response.json(
        { articles: [] },
        { headers: { 'content-type': 'application/json' } },
      ),
    );
  }

  if (url.hostname === 'searxng.test') {
    return Promise.resolve(
      Response.json(
        {
          results: [
            {
              title: 'Private SearXNG result',
              url: 'https://publisher.example/article',
              content: 'A useful attributed search snippet.',
              engines: ['duckduckgo news'],
            },
          ],
        },
        { headers: { 'content-type': 'application/json' } },
      ),
    );
  }

  return Promise.resolve(
    new Response(
      `<article>${'Evidence from the publisher. '.repeat(30)}</article>`,
      {
        headers: { 'content-type': 'text/html' },
      },
    ),
  );
};
