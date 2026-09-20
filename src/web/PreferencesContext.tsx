import { type ReactNode, useCallback, useEffect, useState } from 'react';
import {
  examplePreferences,
  preferencesSchema,
  type Preferences,
} from '../shared/preferences';
import {
  actOnTopicProposal,
  createTopicProposal,
  listTopicProposals,
  PreferencesConflictError,
  readPreferences,
  replacePreferences,
  type StoredTopicProposal,
} from './preferences-client';
import type { TopicProposalRequest } from '../shared/preferences';
import { PreferencesContext } from './preferences-state';

/** Supplies Agent-backed preferences to the manual Topics and Settings screens. */
export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [preferences, setPreferences] = useState<Preferences | null>(null);
  const [configured, setConfigured] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [proposals, setProposals] = useState<StoredTopicProposal[]>([]);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const [response, pendingProposals] = await Promise.all([
        readPreferences(),
        listTopicProposals(),
      ]);

      setConfigured(response.configured);
      setProposals(pendingProposals);
      setPreferences(
        response.configured
          ? response.preferences
          : structuredClone(examplePreferences),
      );
    } catch {
      setError(
        'Preferences could not be loaded. Check your connection and try again.',
      );
      setPreferences(null);
      setProposals([]);
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

  const proposeTopic = useCallback(async (request: TopicProposalRequest) => {
    const proposal = await createTopicProposal(request);

    setProposals((current) => [...current, proposal]);
  }, []);

  const actOnProposal = useCallback(
    async (proposalId: string, action: 'apply' | 'discard') => {
      const saved = await actOnTopicProposal(proposalId, action);

      if (saved !== undefined) {
        setPreferences(saved);
        setConfigured(true);
      }

      setProposals((current) =>
        current.filter((proposal) => proposal.proposal.id !== proposalId),
      );
    },
    [],
  );

  return (
    <PreferencesContext.Provider
      value={{
        preferences,
        configured,
        loading,
        error,
        proposals,
        reload,
        update,
        proposeTopic,
        actOnProposal,
      }}
    >
      {children}
    </PreferencesContext.Provider>
  );
}
