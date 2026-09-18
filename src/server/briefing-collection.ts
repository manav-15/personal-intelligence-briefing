import { z } from 'zod';
import {
  evidenceSchema,
  storyCandidateSchema,
  type StoryCandidate,
} from '../shared/inspection';
import {
  effectiveTopicPreferences,
  preferencesSchema,
  type Preferences,
  type Topic,
} from '../shared/preferences';
import { hasInformativeDescription } from './content';
import {
  discoverGdelt,
  discoverGoogleNews,
  discoverSearxng,
  type Fetcher,
} from './discovery';
import { retrieveEvidence } from './evidence';

const collectionProviderSchema = z.enum(['searxng', 'google-news', 'gdelt']);

/** Fixed limits for one collection attempt before ranking or model composition. */
export const briefingCollectionBudgetSchema = z.strictObject({
  maxQueries: z.number().int().min(1).max(60),
  maxResultsPerQuery: z.number().int().min(1).max(25),
  maxCandidates: z.number().int().min(1).max(100),
  maxEvidenceFetches: z.number().int().min(1).max(50),
  maxProviderRetries: z.number().int().min(0).max(2),
});

/** Current bounded collection defaults; retries remain disabled until Workflow backoff exists. */
export const defaultBriefingCollectionBudget = {
  maxQueries: 12,
  maxResultsPerQuery: 8,
  maxCandidates: 36,
  maxEvidenceFetches: 12,
  maxProviderRetries: 0,
} as const;

/** A durable preference snapshot tied to a single briefing run. */
export const briefingCollectionSnapshotSchema = z.strictObject({
  runId: z.uuid(),
  preferenceRevision: z.number().int().nonnegative(),
  preferences: preferencesSchema,
  budget: briefingCollectionBudgetSchema,
});

/** One exact-URL-deduplicated candidate and its temporary run-scoped evidence. */
export const briefingCandidateSchema = z.strictObject({
  story: storyCandidateSchema,
  topicIds: z.array(z.string().min(1).max(64)).min(1).max(30),
  evidence: evidenceSchema,
  evidenceTier: z.enum(['article', 'description', 'headline-only']),
});

/** A bounded, attributable collection failure that permits a partial run. */
export const briefingCollectionFailureSchema = z.strictObject({
  stage: z.enum(['discovery', 'evidence', 'budget']),
  provider: collectionProviderSchema.nullable(),
  message: z.string().trim().min(1).max(1_000),
});

/** Persistable output from collection before semantic relevance or summarization. */
export const briefingCollectionResultSchema = z.strictObject({
  candidates: z.array(briefingCandidateSchema).max(100),
  failures: z.array(briefingCollectionFailureSchema).max(200),
});

/** Validated durable input supplied to the collection module. */
export type BriefingCollectionSnapshot = z.infer<
  typeof briefingCollectionSnapshotSchema
>;
/** One selected candidate and its temporary evidence outcome. */
export type BriefingCandidate = z.infer<typeof briefingCandidateSchema>;
/** Output passed to the Agent for run-scoped persistence. */
export type BriefingCollectionResult = z.infer<
  typeof briefingCollectionResultSchema
>;

type DiscoveryCall = (
  query: string,
  maxResults: number,
) => Promise<{
  stories: StoryCandidate[];
  failures: Array<{ message: string }>;
}>;
type CollectionState = { queryCount: number };
type CollectionProvider = z.infer<typeof collectionProviderSchema>;
type CandidateLead = { story: StoryCandidate; topicIds: string[] };

/** Optional configured discovery channels for a collection run. */
export type BriefingCollectionProviders = {
  searxng?: { baseUrl: string; fetcher: Fetcher };
};

/** Collects deterministic discovery leads and bounded evidence without semantic ranking. */
export async function collectBriefingCandidates(
  value: BriefingCollectionSnapshot,
  fetcher: Fetcher = fetch,
  providers: BriefingCollectionProviders = {},
): Promise<BriefingCollectionResult> {
  const snapshot = briefingCollectionSnapshotSchema.parse(value);
  const calls = providerCalls(fetcher, providers);
  const candidates = new Map<string, CandidateLead>();
  const failures: BriefingCollectionResult['failures'] = [];
  const state: CollectionState = { queryCount: 0 };

  for (const topic of snapshot.preferences.topics) {
    if (!topic.enabled) continue;

    const completed = await collectTopicCandidates(
      topic,
      snapshot,
      calls,
      candidates,
      failures,
      state,
    );

    if (!completed) {
      failures.push({
        stage: 'budget',
        provider: null,
        message: 'Discovery stopped after reaching the query budget.',
      });

      return retrieveCandidateEvidence(snapshot, candidates, failures, fetcher);
    }
  }

  return retrieveCandidateEvidence(snapshot, candidates, failures, fetcher);
}

function providerCalls(
  fetcher: Fetcher,
  providers: BriefingCollectionProviders,
): Array<[CollectionProvider, DiscoveryCall]> {
  const calls: Array<[CollectionProvider, DiscoveryCall]> = [];
  const searxng = providers.searxng;

  if (searxng !== undefined) {
    calls.push([
      'searxng',
      (query, maxResults) =>
        discoverSearxng(
          { query, maxResults, timeRange: 'any' },
          searxng.baseUrl,
          searxng.fetcher,
        ),
    ]);
  }

  calls.push(
    [
      'google-news',
      (query, maxResults) => discoverGoogleNews({ query, maxResults }, fetcher),
    ],
    [
      'gdelt',
      (query, maxResults) => discoverGdelt({ query, maxResults }, fetcher),
    ],
  );

  return calls;
}

async function collectTopicCandidates(
  topic: Topic,
  snapshot: BriefingCollectionSnapshot,
  calls: Array<[CollectionProvider, DiscoveryCall]>,
  candidates: Map<string, CandidateLead>,
  failures: BriefingCollectionResult['failures'],
  state: CollectionState,
): Promise<boolean> {
  for (const query of compileTopicQueries(topic)) {
    for (const [provider, discover] of calls) {
      if (state.queryCount >= snapshot.budget.maxQueries) return false;

      state.queryCount += 1;
      const result = await collectProviderResult(
        discover,
        query,
        snapshot.budget.maxResultsPerQuery,
        provider,
        failures,
      );

      if (result === undefined) continue;

      recordDiscoveryFailures(failures, provider, result);
      addEligibleCandidates(candidates, result.stories, snapshot, topic);
    }
  }

  return true;
}

async function collectProviderResult(
  discover: DiscoveryCall,
  query: string,
  maxResults: number,
  provider: CollectionProvider,
  failures: BriefingCollectionResult['failures'],
): Promise<Awaited<ReturnType<DiscoveryCall>> | undefined> {
  try {
    return await discover(query, maxResults);
  } catch (error) {
    failures.push({
      stage: 'discovery',
      provider,
      message: providerExceptionMessage(error),
    });

    return undefined;
  }
}

function providerExceptionMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim())
    return `Provider exception: ${error.message.trim().slice(0, 900)}`;

  return 'Provider threw an unknown exception.';
}

function recordDiscoveryFailures(
  failures: BriefingCollectionResult['failures'],
  provider: CollectionProvider,
  result: Awaited<ReturnType<DiscoveryCall>>,
): void {
  for (const failure of result.failures) {
    failures.push({ stage: 'discovery', provider, message: failure.message });
  }
}

function addEligibleCandidates(
  candidates: Map<string, CandidateLead>,
  stories: StoryCandidate[],
  snapshot: BriefingCollectionSnapshot,
  topic: Topic,
): void {
  for (const story of stories) {
    if (!isEligibleForTopic(story, snapshot.preferences, topic)) continue;
    const existing = candidates.get(story.sourceUrl);

    if (existing !== undefined) {
      if (!existing.topicIds.includes(topic.id))
        existing.topicIds.push(topic.id);

      continue;
    }

    if (candidates.size >= snapshot.budget.maxCandidates) continue;

    candidates.set(story.sourceUrl, { story, topicIds: [topic.id] });
  }
}

function compileTopicQueries(topic: Topic): string[] {
  const concepts = topic.searchConcepts.map((concept) =>
    concept.terms.join(' '),
  );
  const queries = concepts.length > 0 ? concepts : [topic.interests.join(' ')];

  return [...new Set(queries.map((query) => query.trim()).filter(Boolean))];
}

function isEligibleForTopic(
  story: StoryCandidate,
  preferences: Preferences,
  topic: Topic,
): boolean {
  const effective = effectiveTopicPreferences(preferences, topic);
  const sourceHost = new URL(story.sourceUrl).hostname.toLowerCase();
  const blocked = effective.sources.blocked.some(
    (source) => new URL(source).hostname.toLowerCase() === sourceHost,
  );

  if (blocked) return false;
  const text = `${story.title} ${story.description?.text ?? ''}`.toLowerCase();

  return !effective.exclusions.some((exclusion) =>
    text.includes(exclusion.toLowerCase()),
  );
}

async function retrieveCandidateEvidence(
  snapshot: BriefingCollectionSnapshot,
  candidates: Map<string, CandidateLead>,
  failures: BriefingCollectionResult['failures'],
  fetcher: Fetcher,
): Promise<BriefingCollectionResult> {
  const collected: BriefingCandidate[] = [];
  let evidenceFetches = 0;

  for (const candidate of candidates.values()) {
    if (evidenceFetches >= snapshot.budget.maxEvidenceFetches) {
      failures.push({
        stage: 'budget',
        provider: null,
        message: 'Evidence retrieval stopped after reaching its budget.',
      });
      break;
    }
    evidenceFetches += 1;
    const evidence = await retrieveEvidence(candidate.story, fetcher);
    const evidenceTier = tierFor(candidate.story, evidence);

    if (evidence.status === 'unavailable') {
      failures.push({
        stage: 'evidence',
        provider: null,
        message: `${candidate.story.sourceUrl}: ${evidence.reason}`,
      });
    }

    collected.push({ ...candidate, evidence, evidenceTier });
  }

  return briefingCollectionResultSchema.parse({
    candidates: collected,
    failures,
  });
}

function tierFor(
  story: StoryCandidate,
  evidence: BriefingCandidate['evidence'],
): BriefingCandidate['evidenceTier'] {
  if (evidence.status === 'usable') return 'article';

  if (
    story.description !== undefined &&
    hasInformativeDescription(story.title, story.description.text)
  )
    return 'description';

  return 'headline-only';
}
