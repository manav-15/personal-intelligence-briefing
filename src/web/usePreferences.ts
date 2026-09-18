import { useContext } from 'react';
import {
  PreferencesContext,
  type PreferencesContextValue,
} from './preferences-state';

/** Reads the persisted preferences context from a screen inside the application shell. */
export function usePreferences(): PreferencesContextValue {
  const value = useContext(PreferencesContext);

  if (value === null)
    throw new Error('usePreferences must be used inside PreferencesProvider.');

  return value;
}
