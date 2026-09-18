import { type ReactNode, useCallback, useEffect, useState } from 'react';
import {
  examplePreferences,
  preferencesSchema,
  type Preferences,
} from '../shared/preferences';
import {
  PreferencesConflictError,
  readPreferences,
  replacePreferences,
} from './preferences-client';
import { PreferencesContext } from './preferences-state';

/** Supplies Agent-backed preferences to the manual Topics and Settings screens. */
export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [preferences, setPreferences] = useState<Preferences | null>(null);
  const [configured, setConfigured] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await readPreferences();

      setConfigured(response.configured);
      setPreferences(
        response.configured
          ? response.preferences
          : structuredClone(examplePreferences),
      );
    } catch {
      setError(
        'Preferences are unavailable. Start the local Worker with PREFERENCES_DIAGNOSTICS_ENABLED=true.',
      );
      setPreferences(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void Promise.resolve().then(reload);
  }, [reload]);

  const update = useCallback(
    async (transform: (current: Preferences) => Preferences) => {
      if (preferences === null) throw new Error('Preferences have not loaded.');

      const candidate = preferencesSchema.parse(
        transform(structuredClone(preferences)),
      );

      try {
        const saved = await replacePreferences(candidate);

        setPreferences(saved);
        setConfigured(true);
        setError(null);
      } catch (caught) {
        if (caught instanceof PreferencesConflictError) {
          await reload();
          throw new Error(
            'Another update was saved first. The latest preferences were reloaded; review your change and try again.',
          );
        }

        throw caught;
      }
    },
    [preferences, reload],
  );

  return (
    <PreferencesContext.Provider
      value={{ preferences, configured, loading, error, reload, update }}
    >
      {children}
    </PreferencesContext.Provider>
  );
}
