import type { Briefing, BriefingRunStatusResponse } from '../shared/briefings';
import { readBriefingRunStatus, readTodayBriefing } from './briefings-client';

/** Polls serially, retries transient reads, and stops after a fully loaded terminal result. */
export function pollBriefingRun(
  runId: string,
  update: (
    status: BriefingRunStatusResponse,
    edition: Briefing | null | undefined,
  ) => void,
  onError: () => void,
): () => void {
  let cancelled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const poll = async () => {
    try {
      const status = await readBriefingRunStatus(runId);
      const edition =
        status.status === 'published' ? await readTodayBriefing() : undefined;

      if (cancelled) return;
      update(status, edition);

      if (status.status !== 'running') return;
    } catch {
      if (cancelled) return;
      onError();
    }

    timer = setTimeout(() => void poll(), 2_000);
  };

  void poll();

  return () => {
    cancelled = true;
    clearTimeout(timer);
  };
}
