import { z } from 'zod';
import { preferencesSchema, type Preferences } from '../shared/preferences';

const storedPreferencesSchema = z.union([
  z.strictObject({ configured: z.literal(false) }),
  z.strictObject({
    configured: z.literal(true),
    preferences: preferencesSchema,
  }),
]);
const savedPreferencesSchema = z.strictObject({
  preferences: preferencesSchema,
});
const conflictSchema = z.strictObject({
  error: z.string(),
  currentRevision: z.number().int().nonnegative(),
});

/** Result of reading the locally enabled preferences diagnostic endpoint. */
export type StoredPreferencesResponse = z.infer<typeof storedPreferencesSchema>;

/** Indicates that another request saved preferences before this browser update. */
export class PreferencesConflictError extends Error {
  /** Revision that was current when the Worker rejected the replacement. */
  readonly currentRevision: number;

  constructor(currentRevision: number) {
    super('Preferences changed before this update could be applied.');
    this.currentRevision = currentRevision;
  }
}

/** Reads the validated persisted document or the first-run absence state. */
export async function readPreferences(): Promise<StoredPreferencesResponse> {
  const response = await fetch('/api/preferences');

  if (!response.ok) throw new Error('Could not load preferences.');

  return storedPreferencesSchema.parse(await response.json());
}

/** Replaces one complete validated document using its current optimistic revision. */
export async function replacePreferences(
  document: Preferences,
): Promise<Preferences> {
  const response = await fetch('/api/preferences', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ document, expectedRevision: document.revision }),
  });

  if (response.status === 409) {
    const conflict = conflictSchema.parse(await response.json());

    throw new PreferencesConflictError(conflict.currentRevision);
  }

  if (!response.ok) throw new Error('Could not save preferences.');

  return savedPreferencesSchema.parse(await response.json()).preferences;
}
