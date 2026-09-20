import { pollBriefingRun } from './briefing-polling';
import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  Briefing,
  BriefingArchiveEntry,
  BriefingRunStatusResponse,
} from '../shared/briefings';
import {
  generateBriefing,
  listBriefingArchive,
  readCurrentBriefingRun,
  readTodayBriefing,
} from './briefings-client';

/** Owns Today loading, durable run recovery, and a single non-overlapping poll loop. */
export function useBriefing() {
  const [briefing, setBriefing] = useState<Briefing | null>(null);
  const [latest, setLatest] = useState<BriefingArchiveEntry | null>(null);
  const [run, setRun] = useState<BriefingRunStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const submitting = useRef(false);
  const runId = run?.status === 'running' ? run.runId : null;

  useEffect(() => {
    let cancelled = false;

    void Promise.all([readTodayBriefing(), readCurrentBriefingRun()])
      .then(async ([edition, current]) => {
        const archive = edition === null ? await listBriefingArchive() : [];

        if (cancelled) return;
        setLatest(archive[0] ?? null);
        setBriefing(edition);
        setLoaded(true);
        setRun(current);
        setError(null);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setError('Your briefing could not be loaded. Please try again.');
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [attempt]);

  useEffect(() => {
    if (runId === null) return;

    return pollBriefingRun(
      runId,
      (status, edition) => {
        setError(null);
        setRun(status);

        if (edition !== undefined) setBriefing(edition);
      },
      () => {
        setError(
          'Connection interrupted. We’re checking again; your run continues in the background.',
        );
      },
    );
  }, [runId]);

  const generate = useCallback(async () => {
    if (submitting.current || runId !== null) return;
    submitting.current = true;
    setStarting(true);
    setError(null);

    try {
      const result = await generateBriefing();

      setRun({
        runId: result.runId,
        status: 'running',
        failureMessage: null,
        collectionFailures: [],
      });
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Could not start generation.',
      );
    } finally {
      submitting.current = false;
      setStarting(false);
    }
  }, [runId]);

  return {
    briefing,
    latest,
    run,
    loading,
    busy: starting || runId !== null,
    canGenerate: loaded && !starting && runId === null,
    error,
    generate,
    reload: () => {
      setLoading(true);
      setAttempt((value) => value + 1);
    },
  };
}
