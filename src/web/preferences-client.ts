import { z } from 'zod';
import {
  preferencesSchema,
  topicProposalSchema,
  topicProposalRequestSchema,
  type Preferences,
  type TopicProposalRequest,
} from '../shared/preferences';

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
const storedTopicProposalSchema = z.strictObject({
  proposal: topicProposalSchema,
  promptVersion: z.string().min(1),
});
const pendingProposalsSchema = z.strictObject({
  proposals: z.array(storedTopicProposalSchema),
});
const createdProposalSchema = z.strictObject({
  proposal: storedTopicProposalSchema,
});
const proposalActionSchema = z.strictObject({
  preferences: preferencesSchema.optional(),
});

/** A proposal available for review before it can change saved preferences. */
export type StoredTopicProposal = z.infer<typeof storedTopicProposalSchema>;

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

/** Lists proposal records that remain pending for the local single user. */
export async function listTopicProposals(): Promise<StoredTopicProposal[]> {
  const response = await fetch('/api/preferences/proposals');

  if (!response.ok) throw new Error('Could not load topic proposals.');

  return pendingProposalsSchema.parse(await response.json()).proposals;
}

/** Requests a validated, stored topic proposal without changing preferences. */
export async function createTopicProposal(
  request: TopicProposalRequest,
): Promise<StoredTopicProposal> {
  const input = topicProposalRequestSchema.parse(request);
  const response = await fetch('/api/preferences/proposals', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });

  if (!response.ok) throw new Error(await proposalError(response));

  return createdProposalSchema.parse(await response.json()).proposal;
}

/** Explicitly applies or discards a stored proposal after the user has reviewed it. */
export async function actOnTopicProposal(
  proposalId: string,
  action: 'apply' | 'discard',
): Promise<Preferences | undefined> {
  const response = await fetch(`/api/preferences/proposals/${proposalId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action }),
  });

  if (!response.ok) throw new Error(await proposalError(response));

  return proposalActionSchema.parse(await response.json()).preferences;
}

async function proposalError(response: Response): Promise<string> {
  const payload = await response.json().catch(() => undefined);
  const parsed = z.object({ error: z.string() }).safeParse(payload);

  return parsed.success ? parsed.data.error : 'Could not update the proposal.';
}
