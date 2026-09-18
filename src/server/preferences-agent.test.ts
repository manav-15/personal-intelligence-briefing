import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { briefingSchema } from '../shared/briefings';
import { examplePreferences, preferencesSchema } from '../shared/preferences';
import worker from './index';
import { PersonalBriefingAgent } from './preferences-agent';

describe('persistence document contract', () => {
  it('does not use suggested defaults as a saved document', () => {
    const suggested = preferencesSchema.parse(examplePreferences);

    expect(suggested.revision).toBe(0);
    expect(JSON.stringify(suggested)).not.toContain('configured');
  });
  it('makes a valid replacement advance revision without changing its topic IDs', () => {
    const replacement = preferencesSchema.parse({
      ...examplePreferences,
      revision: 0,
    });
    const saved = { ...replacement, revision: 1 };

    expect(saved.topics.map((topic) => topic.id)).toEqual([
      'ai',
      'world',
      'liverpool',
    ]);
  });
  it('maps Agent reads and revision conflicts to stable local HTTP responses', async () => {
    const stub = {
      readPreferences: () => ({ configured: false as const }),
      replacePreferences: () => ({ ok: false as const, currentRevision: 3 }),
    };
    const env = {
      PREFERENCES_DIAGNOSTICS_ENABLED: 'true',
      PERSONAL_BRIEFING: {
        idFromName: () => ({}) as DurableObjectId,
        get: () => stub,
      } as unknown as DurableObjectNamespace<PersonalBriefingAgent>,
    };
    const read = await worker.fetch(
      new Request('https://local.test/api/preferences'),
      env,
    );

    expect(await read.json()).toEqual({ configured: false });
    const replace = await worker.fetch(
      new Request('https://local.test/api/preferences', {
        method: 'PUT',
        headers: {
          Origin: 'https://local.test',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          document: examplePreferences,
          expectedRevision: 0,
        }),
      }),
      env,
    );

    expect(replace.status).toBe(409);
    expect(await replace.json()).toEqual({
      error: 'Preferences changed before this update could be applied.',
      currentRevision: 3,
    });
  });

  it('keeps a run preference snapshot and removes temporary evidence after publication', () => {
    const agent = inMemoryAgent();
    const saved = agent.replacePreferences(examplePreferences, 0, 'test-user');

    if (!saved.ok) throw new Error('Expected preferences to save.');
    const runId = 'ad7fb1a7-9d5d-4cbe-a571-c8e3a0d0f0ee';

    expect(
      agent.startBriefingRun(
        { runId, preferenceRevision: saved.preferences.revision },
        'test-user',
      ),
    ).toEqual({ ok: true, created: true });
    const snapshot = agent.readBriefingCollectionSnapshot(runId, 'test-user');

    expect(snapshot?.preferences.revision).toBe(1);
    expect(
      agent.storeBriefingCollection(
        runId,
        {
          candidates: [
            {
              story: {
                id: 'https://publisher.example/article',
                title: 'Example story',
                publisher: 'Example',
                publishedAt: null,
                sourceUrl: 'https://publisher.example/article',
                discovery: 'gdelt',
              },
              topicIds: ['ai'],
              evidence: {
                status: 'usable',
                articleUrl: 'https://publisher.example/article',
                text: 'Temporary article evidence.',
                truncated: false,
                provenance: 'publisher-page',
                pageTitle: 'Example story',
                extraction: 'article-region',
              },
              evidenceTier: 'article',
            },
          ],
          failures: [],
        },
        'test-user',
      ),
    ).toBe(true);
    expect(
      agent.readBriefingCollection(runId, 'test-user')?.candidates,
    ).toHaveLength(1);
    const briefing = briefingSchema.parse({
      schemaVersion: 1,
      runId,
      date: '2026-09-19',
      preferenceRevision: saved.preferences.revision,
      completeness: 'complete',
      limitations: [],
      items: [
        {
          id: 'example-story',
          topicIds: ['ai'],
          headline: 'Example story',
          summary: 'An evidence-grounded summary.',
          publishedAt: null,
          citations: [
            {
              sourceUrl: 'https://publisher.example/article',
              publisher: 'Example',
              evidenceTier: 'article',
            },
          ],
        },
      ],
      publishedAt: '2026-09-19T00:00:00.000Z',
    });

    expect(agent.publishBriefing(briefing, 'test-user')).toMatchObject({
      ok: true,
      idempotent: false,
    });
    expect(agent.readBriefingCollection(runId, 'test-user')).toBeUndefined();
  });

  it('removes temporary evidence after marking a run failed', () => {
    const agent = inMemoryAgent();
    const saved = agent.replacePreferences(examplePreferences, 0, 'test-user');

    if (!saved.ok) throw new Error('Expected preferences to save.');
    const runId = 'e2bbb4f6-7d98-49a3-912e-82b1edcf69aa';

    agent.startBriefingRun(
      { runId, preferenceRevision: saved.preferences.revision },
      'test-user',
    );
    agent.storeBriefingCollection(runId, temporaryCollection(), 'test-user');

    expect(agent.failBriefingRun(runId, 'test-user')).toBe(true);
    expect(
      testDatabase(agent).prepare('SELECT * FROM briefing_candidates').all(),
    ).toEqual([]);
  });
});

function temporaryCollection() {
  return {
    candidates: [
      {
        story: {
          id: 'https://publisher.example/article',
          title: 'Example story',
          publisher: 'Example',
          publishedAt: null,
          sourceUrl: 'https://publisher.example/article',
          discovery: 'gdelt' as const,
        },
        topicIds: ['ai'],
        evidence: {
          status: 'usable' as const,
          articleUrl: 'https://publisher.example/article',
          text: 'Temporary article evidence.',
          truncated: false,
          provenance: 'publisher-page' as const,
          pageTitle: 'Example story',
          extraction: 'article-region' as const,
        },
        evidenceTier: 'article' as const,
      },
    ],
    failures: [],
  };
}

function testDatabase(agent: PersonalBriefingAgent): DatabaseSync {
  return (agent as unknown as { testDatabase: DatabaseSync }).testDatabase;
}

function inMemoryAgent(): PersonalBriefingAgent {
  const database = new DatabaseSync(':memory:');
  const execute = (query: string, values: unknown[]) => {
    const statement = database.prepare(query);

    if (/^\s*SELECT/iu.test(query)) return statement.all(...values);

    return { rowsWritten: Number(statement.run(...values).changes) };
  };
  const agent = Object.create(PersonalBriefingAgent.prototype) as {
    ctx: unknown;
    sql: (
      strings: TemplateStringsArray,
      ...values: unknown[]
    ) => Array<{ document: string }>;
  };

  agent.ctx = {
    storage: {
      transactionSync: <T>(callback: () => T) => callback(),
      sql: {
        exec: (query: string, ...values: unknown[]) => execute(query, values),
      },
    },
  };
  agent.sql = (strings, ...values) =>
    execute(
      strings.reduce(
        (query, part, index) =>
          `${query}${part}${index < values.length ? '?' : ''}`,
        '',
      ),
      values,
    ) as Array<{ document: string }>;
  (agent as unknown as { testDatabase: DatabaseSync }).testDatabase = database;

  return agent as unknown as PersonalBriefingAgent;
}
