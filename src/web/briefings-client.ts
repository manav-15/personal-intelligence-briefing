import {
  briefingArchiveSchema,
  latestBriefingSchema,
  type Briefing,
  type BriefingArchiveEntry,
} from '../shared/briefings';

/** Reads the latest published briefing for the Today screen. */
export async function readLatestBriefing(): Promise<Briefing | null> {
  const response = await fetch('/api/briefings/today');

  if (!response.ok) throw new Error('Could not load the latest briefing.');

  return latestBriefingSchema.parse(await response.json()).briefing;
}

/** Reads archive metadata without requesting full story summaries. */
export async function listBriefingArchive(): Promise<BriefingArchiveEntry[]> {
  const response = await fetch('/api/briefings/archive');

  if (!response.ok) throw new Error('Could not load briefing archive.');

  return briefingArchiveSchema.parse(await response.json()).briefings;
}
