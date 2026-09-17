/** Supported discovery providers; each implementation lives in its own file. */
export type DiscoveryProvider = 'google-news' | 'gdelt';

/** A normalized lead; a source link alone does not establish article evidence. */
export type StoryCandidate = {
  id: string;
  title: string;
  publisher: string | null;
  publishedAt: string | null;
  sourceUrl: string;
  discovery: DiscoveryProvider;
};

/** Recoverable provider failures allow collection to produce incomplete briefings. */
export type DiscoveryFailure = {
  code:
    | 'feed-fetch-failed'
    | 'feed-too-large'
    | 'invalid-feed'
    | 'provider-fetch-failed'
    | 'provider-rate-limited'
    | 'response-too-large'
    | 'invalid-response';
  message: string;
};

/** Bounded normalized leads and explicit collection failures. */
export type DiscoveryResult = {
  stories: StoryCandidate[];
  failures: DiscoveryFailure[];
};

/** Fetch boundary shared by the Worker and deterministic provider fixtures. */
export type Fetcher = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;
