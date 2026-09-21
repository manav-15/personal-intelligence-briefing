import { z } from 'zod';
import {
  briefingArchiveSchema,
  briefingGenerationResponseSchema,
  briefingRunStatusResponseSchema,
  latestBriefingSchema,
  type Briefing,
  type BriefingArchiveEntry,
  type BriefingRunStatusResponse,
} from '../shared/briefings';

/** Reads only the server-selected briefing for the current preference-local date. */
export async function readTodayBriefing(): Promise<Briefing | null> {
  const response = await fetch('/api/briefings/today');

  if (!response.ok) throw new Error('Could not load today’s briefing.');

  return latestBriefingSchema.parse(await response.json()).briefing;
}

/** Starts one server-owned manual generation run. */
export async function generateBriefing(): Promise<{
  runId: string;
  created: boolean;
}> {
  const response = await fetch('/api/briefings/generate', { method: 'POST' });

  if (!response.ok) {
    const body = z
      .object({ error: z.string().max(1_000) })
      .safeParse(await response.json());

    throw new Error(
      body.success ? body.data.error : 'Could not start briefing generation.',
    );
  }

  return briefingGenerationResponseSchema.parse(await response.json());
}

/** Reads server-owned state for one manually requested generation run. */
export async function readBriefingRunStatus(
  runId: string,
): Promise<BriefingRunStatusResponse> {
  const response = await fetch(`/api/briefings/runs/${runId}`);

  if (!response.ok) throw new Error('Could not load briefing run status.');

  return briefingRunStatusResponseSchema.parse(await response.json());
}

/** Reads archive metadata without requesting full story summaries. */
export async function listBriefingArchive(): Promise<BriefingArchiveEntry[]> {
  const response = await fetch('/api/briefings/archive');

  if (!response.ok) throw new Error('Could not load briefing archive.');

  return briefingArchiveSchema.parse(await response.json()).briefings;
}

/** Permanently deletes one retained briefing edition. */
export async function deleteBriefing(runId: string): Promise<void> {
  const response = await fetch(`/api/briefings/${encodeURIComponent(runId)}`, {
    method: 'DELETE',
  });

  if (!response.ok) throw new Error('Could not delete this briefing.');
}

/** Restores the most recent durable run after navigation or reload. */
export async function readCurrentBriefingRun(): Promise<BriefingRunStatusResponse | null> {
  const response = await fetch('/api/briefings/current-run');

  if (!response.ok) throw new Error('Could not restore generation status.');

  return z
    .strictObject({ run: briefingRunStatusResponseSchema.nullable() })
    .parse(await response.json()).run;
}

/** Opens a complete immutable edition from the archive. */
export async function readArchivedBriefing(
  runId: string,
): Promise<Briefing | null> {
  const response = await fetch(
    `/api/briefings/archive/${encodeURIComponent(runId)}`,
  );

  if (!response.ok) throw new Error('Could not load this edition.');

  return latestBriefingSchema.parse(await response.json()).briefing;
}
