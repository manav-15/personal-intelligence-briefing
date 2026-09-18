import { describe, expect, it } from 'vitest';
import { examplePreferences, preferencesSchema } from '../shared/preferences';
import worker from './index';
import type { PersonalBriefingAgent } from './preferences-agent';

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
});
