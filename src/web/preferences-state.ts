import { createContext } from 'react';
import type { Preferences, TopicProposalRequest } from '../shared/preferences';
import type { StoredTopicProposal } from './preferences-client';

/** Browser state supplied by the local persisted-preferences integration. */
export type PreferencesContextValue = {
  preferences: Preferences | null;
  configured: boolean;
  loading: boolean;
  error: string | null;
  proposals: StoredTopicProposal[];
  reload: () => Promise<void>;
  update: (transform: (current: Preferences) => Preferences) => Promise<void>;
  proposeTopic: (request: TopicProposalRequest) => Promise<void>;
  actOnProposal: (
    proposalId: string,
    action: 'apply' | 'discard',
  ) => Promise<void>;
};

/** Shared context kept separate from components to preserve Fast Refresh boundaries. */
export const PreferencesContext = createContext<PreferencesContextValue | null>(
  null,
);
