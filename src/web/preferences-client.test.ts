import { afterEach, describe, expect, it, vi } from 'vitest';
import { examplePreferences } from '../shared/preferences';
import {
  PreferencesConflictError,
  readPreferences,
  replacePreferences,
} from './preferences-client';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('preferences client', () => {
  it('validates first-run and saved documents returned by the Worker', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(Response.json({ configured: false }))),
    );

    await expect(readPreferences()).resolves.toEqual({ configured: false });
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          Response.json({ configured: true, preferences: examplePreferences }),
        ),
      ),
    );

    await expect(readPreferences()).resolves.toEqual({
      configured: true,
      preferences: examplePreferences,
    });
  });

  it('sends a complete revision-checked document and validates its response', async () => {
    const fetcher = vi.fn(() =>
      Promise.resolve(Response.json({ preferences: examplePreferences })),
    );

    vi.stubGlobal('fetch', fetcher);
    await expect(replacePreferences(examplePreferences)).resolves.toEqual(
      examplePreferences,
    );
    expect(fetcher).toHaveBeenCalledWith('/api/preferences', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        document: examplePreferences,
        expectedRevision: examplePreferences.revision,
      }),
    });
  });

  it('reports a revision conflict separately from an unavailable local API', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          Response.json(
            {
              error: 'Preferences changed before this update could be applied.',
              currentRevision: 4,
            },
            { status: 409 },
          ),
        ),
      ),
    );

    await expect(replacePreferences(examplePreferences)).rejects.toEqual(
      new PreferencesConflictError(4),
    );
  });
});
