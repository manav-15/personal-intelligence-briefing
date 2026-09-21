/** A normalized lead; a source link alone does not establish article evidence. */
export type { StoryCandidate, DiscoveryResult } from '../../shared/inspection';

/** Recoverable provider failures allow collection to produce incomplete briefings. */
export type DiscoveryFailure = {
  code:
    | 'feed-fetch-failed'
    | 'feed-too-large'
    | 'invalid-feed'
    | 'provider-fetch-failed'
    | 'provider-rate-limited'
    | 'response-too-large'
    | 'invalid-response'
    | 'provider-engine-failed';
  message: string;
};

/** Fetch boundary shared by the Worker and deterministic provider fixtures. */
export type Fetcher = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;
