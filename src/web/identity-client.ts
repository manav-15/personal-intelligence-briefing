import { identitySchema } from '../shared/identity';

/** Reads the owner id the Worker resolved for this browser session. */
export async function readOwnerId(): Promise<string> {
  const response = await fetch('/api/identity');

  if (!response.ok) throw new Error('Could not resolve the chat owner.');

  return identitySchema.parse(await response.json()).userId;
}
