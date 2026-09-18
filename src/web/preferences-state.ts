import { createContext } from 'react';
import type { Preferences } from '../shared/preferences';

/** Browser state supplied by the local persisted-preferences integration. */
export type PreferencesContextValue = {
  preferences: Preferences | null;
  configured: boolean;
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
  update: (transform: (current: Preferences) => Preferences) => Promise<void>;
};

/** Shared context kept separate from components to preserve Fast Refresh boundaries. */
export const PreferencesContext = createContext<PreferencesContextValue | null>(
  null,
);
