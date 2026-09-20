import {
  briefingDiagnosticsSchema,
  type BriefingDiagnostics,
  type BriefingCandidateDiagnostic,
} from '../shared/briefing-diagnostics';
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
  maxDateResolutionFetches: z.number().int().min(0).max(20).default(6),
  maxProviderRetries: z.number().int().min(0).max(2),
});

/** Current bounded collection defaults; retries remain disabled until Workflow backoff exists. */
export const defaultBriefingCollectionBudget = {
  maxQueries: 12,
  maxResultsPerQuery: 8,
  maxCandidates: 36,
  maxEvidenceFetches: 12,
  maxDateResolutionFetches: 6,
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
  diagnostics: briefingDiagnosticsSchema.optional(),
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
type CollectionProvider = z.infer<typeof collectionProviderSchema>;
type CandidateLead = {
  story: StoryCandidate;
  topicIds: string[];
  recoveredEvidence?: BriefingCandidate['evidence'];
};

/** Optional configured discovery channels for a collection run. */
export type BriefingCollectionProviders = {
  searxng?: { baseUrl: string; fetcher: Fetcher };
};

/** Collects deterministic discovery leads and bounded evidence without semantic ranking. */
export async function collectBriefingCandidates(
  value: BriefingCollectionSnapshot,
  fetcher: Fetcher = fetch,
  providers: BriefingCollectionProviders = {},
  now = new Date(),
): Promise<BriefingCollectionResult> {
  const snapshot = briefingCollectionSnapshotSchema.parse(value);
  const calls = providerCalls(fetcher, providers);
  const candidates = new Map<string, CandidateLead>();
  const undatedCandidates = new Map<string, CandidateLead>();
  const failures: BriefingCollectionResult['failures'] = [];
  const jobs = collectionJobs(snapshot.preferences.topics, calls);
  const diagnostics: BriefingDiagnostics = {
    schemaVersion: 1,
    collectedAt: now.toISOString(),
    queries: [],
    candidates: [],
  };

  for (const job of jobs.slice(0, snapshot.budget.maxQueries)) {
    const result = await collectProviderResult(
      job.discover,
      job.query,
      snapshot.budget.maxResultsPerQuery,
      job.provider,
      failures,
    );

    const queryIndex = diagnostics.queries.length;

    diagnostics.queries.push({
      topicId: job.topic.id,
      provider: job.provider,
      query: job.query.slice(0, 4_000),
      status:
        result === undefined
          ? 'failed'
          : result.failures.length > 0
            ? 'partial'
            : 'ok',
      returned: result?.stories.length ?? 0,
      failureCount: result?.failures.length ?? 1,
    });

    if (result === undefined) continue;
    recordDiscoveryFailures(failures, job.provider, result);
    const observed = result.stories.map((story) =>
      candidateDiagnostic(
        story,
        snapshot.preferences,
        job.topic,
        now,
        queryIndex,
      ),
    );

    diagnostics.candidates.push(...observed);

    for (const [index, story] of result.stories.entries()) {
      const outcome = observed[index]?.outcome;

      if (outcome === 'candidate-budget')
        addCandidate(candidates, story, job.topic);

      if (
        outcome === 'unknown-date' &&
        nonDateRejectionReason(story, snapshot.preferences, job.topic) ===
          undefined
      )
        addCandidate(undatedCandidates, story, job.topic);
    }

    for (const excess of fairEvidenceOrder(
      candidates,
      snapshot.preferences.topics,
    ).slice(snapshot.budget.maxCandidates)) {
      candidates.delete(excess.story.sourceUrl);
    }
  }

  if (jobs.length > snapshot.budget.maxQueries) {
    failures.push({
      stage: 'budget',
      provider: null,
      message: 'Discovery stopped after reaching the query budget.',
    });
  }

  const dateResolutionFetches = await resolveUndatedCandidateDates(
    snapshot,
    undatedCandidates,
    candidates,
    diagnostics,
    failures,
    fetcher,
  );

  const collected = await retrieveCandidateEvidence(
    snapshot,
    candidates,
    failures,
    fetcher,
    dateResolutionFetches,
  );

  finishDiagnostics(diagnostics, candidates, collected.candidates);

  return briefingCollectionResultSchema.parse({ ...collected, diagnostics });
}

function collectionJobs(
  topics: Topic[],
  calls: Array<[CollectionProvider, DiscoveryCall]>,
) {
  const queues = topics
    .filter((topic) => topic.enabled)
    .map((topic) =>
      compileTopicQueries(topic).flatMap((query) =>
        calls.map(([provider, discover]) => ({
          topic,
          query,
          provider,
          discover,
        })),
      ),
    );
  const jobs: Array<{
    topic: Topic;
    query: string;
    provider: CollectionProvider;
    discover: DiscoveryCall;
  }> = [];

  for (
    let round = 0;
    queues.some((queue) => round < queue.length);
    round += 1
  ) {
    for (const queue of queues) {
      const job = queue[round];

      if (job !== undefined) jobs.push(job);
    }
  }

  return jobs;
}

function providerCalls(
  fetcher: Fetcher,
  providers: BriefingCollectionProviders,
): Array<[CollectionProvider, DiscoveryCall]> {
  const calls: Array<[CollectionProvider, DiscoveryCall]> = [];
  const searxng = providers.searxng;

  if (searxng !== undefined) {
    return [
      [
        'searxng',
        (query, maxResults) =>
          discoverSearxng(
            { query, maxResults, timeRange: 'any' },
            searxng.baseUrl,
            searxng.fetcher,
          ),
      ],
    ];
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

function addCandidate(
  candidates: Map<string, CandidateLead>,
  story: StoryCandidate,
  topic: Topic,
): void {
  const existing = candidates.get(story.sourceUrl);

  if (existing !== undefined) {
    if (!existing.topicIds.includes(topic.id)) existing.topicIds.push(topic.id);

    return;
  }

  candidates.set(story.sourceUrl, { story, topicIds: [topic.id] });
}

function compileTopicQueries(topic: Topic): string[] {
  const interests = topic.interests;
  const concepts = topic.searchConcepts.map((concept) =>
    concept.terms.join(' '),
  );

  return [...new Set([...interests, ...concepts].map((query) => query.trim()))];
}

async function resolveUndatedCandidateDates(
  snapshot: BriefingCollectionSnapshot,
  undated: Map<string, CandidateLead>,
  candidates: Map<string, CandidateLead>,
  diagnostics: BriefingDiagnostics,
  failures: BriefingCollectionResult['failures'],
  fetcher: Fetcher,
): Promise<number> {
  const maximum = Math.min(
    snapshot.budget.maxDateResolutionFetches,
    snapshot.budget.maxEvidenceFetches,
  );
  let fetches = 0;

  for (const lead of fairEvidenceOrder(
    undated,
    snapshot.preferences.topics,
  ).slice(0, maximum)) {
    fetches += 1;
    const evidence = await retrieveEvidence(lead.story, fetcher);
    const publicationDate = evidence.publicationDate;

    if (evidence.status === 'unavailable') {
      failures.push({
        stage: 'evidence',
        provider: null,
        message: `${lead.story.sourceUrl}: ${evidence.reason}`,
      });
    }

    if (publicationDate === undefined) continue;
    const story = {
      ...lead.story,
      publishedAt: publicationDate.publishedAt,
      dateProvenance: publicationDate.provenance,
    } satisfies StoryCandidate;
    const reason = rejectionReason(
      story,
      snapshot.preferences,
      topicForLead(lead, snapshot.preferences.topics),
      new Date(diagnostics.collectedAt),
    );

    updateRecoveredDateDiagnostics(
      diagnostics,
      story.sourceUrl,
      publicationDate.publishedAt,
      publicationDate.provenance,
      reason,
    );

    if (reason !== undefined) continue;
    candidates.set(story.sourceUrl, {
      ...lead,
      story,
      recoveredEvidence: evidence,
    });
  }

  return fetches;
}

function topicForLead(lead: CandidateLead, topics: Topic[]): Topic {
  const topic = topics.find((candidate) =>
    lead.topicIds.includes(candidate.id),
  );

  if (topic === undefined)
    throw new Error(
      'Collected candidate does not belong to a configured topic.',
    );

  return topic;
}

function updateRecoveredDateDiagnostics(
  diagnostics: BriefingDiagnostics,
  sourceUrl: string,
  publishedAt: string,
  provenance: 'publisher-jsonld' | 'publisher-meta' | 'publisher-time',
  reason: ReturnType<typeof rejectionReason>,
): void {
  for (const metadata of diagnostics.candidates) {
    if (metadata.sourceUrl !== sourceUrl) continue;

    metadata.publishedAt = publishedAt;
    metadata.dateProvenance = provenance;
    metadata.outcome = reason ?? 'candidate-budget';
  }
}

function rejectionReason(
  story: StoryCandidate,
  preferences: Preferences,
  topic: Topic,
  now: Date,
):
  | 'unknown-date'
  | 'future-date'
  | 'stale'
  | 'blocked-source'
  | 'excluded'
  | undefined {
  const timestamp =
    story.publishedAt === null ? NaN : Date.parse(story.publishedAt);

  if (!Number.isFinite(timestamp)) return 'unknown-date';

  if (timestamp > now.getTime()) return 'future-date';

  if (timestamp < now.getTime() - 86_400_000) return 'stale';

  return nonDateRejectionReason(story, preferences, topic);
}

function nonDateRejectionReason(
  story: StoryCandidate,
  preferences: Preferences,
  topic: Topic,
): 'blocked-source' | 'excluded' | undefined {
  const effective = effectiveTopicPreferences(preferences, topic);
  const sourceHost = new URL(story.sourceUrl).hostname.toLowerCase();
  const blocked = effective.sources.blocked.some(
    (source) => new URL(source).hostname.toLowerCase() === sourceHost,
  );

  if (blocked) return 'blocked-source';
  const text = `${story.title} ${story.description?.text ?? ''}`.toLowerCase();

  return effective.exclusions.some((exclusion) =>
    text.includes(exclusion.toLowerCase()),
  )
    ? 'excluded'
    : undefined;
}

async function retrieveCandidateEvidence(
  snapshot: BriefingCollectionSnapshot,
  candidates: Map<string, CandidateLead>,
  failures: BriefingCollectionResult['failures'],
  fetcher: Fetcher,
  initialEvidenceFetches: number,
): Promise<BriefingCollectionResult> {
  const collected: BriefingCandidate[] = [];
  let evidenceFetches = initialEvidenceFetches;

  for (const candidate of fairEvidenceOrder(
    candidates,
    snapshot.preferences.topics,
  ).slice(0, snapshot.budget.maxCandidates)) {
    if (
      candidate.recoveredEvidence === undefined &&
      evidenceFetches >= snapshot.budget.maxEvidenceFetches
    ) {
      failures.push({
        stage: 'budget',
        provider: null,
        message: 'Evidence retrieval stopped after reaching its budget.',
      });
      break;
    }
    const reusedEvidence = candidate.recoveredEvidence;
    const resolvedEvidence =
      reusedEvidence ??
      (await retrieveCandidateEvidenceOnce(candidate.story, fetcher, () => {
        evidenceFetches += 1;
      }));
    const evidenceTier = tierFor(candidate.story, resolvedEvidence);

    if (
      resolvedEvidence.status === 'unavailable' &&
      reusedEvidence === undefined
    ) {
      failures.push({
        stage: 'evidence',
        provider: null,
        message: `${candidate.story.sourceUrl}: ${resolvedEvidence.reason}`,
      });
    }

    const collectedCandidate = {
      story: candidate.story,
      topicIds: candidate.topicIds,
    };

    collected.push({
      ...collectedCandidate,
      evidence: resolvedEvidence,
      evidenceTier,
    });
  }

  return briefingCollectionResultSchema.parse({
    candidates: collected,
    failures,
  });
}

async function retrieveCandidateEvidenceOnce(
  story: StoryCandidate,
  fetcher: Fetcher,
  recordFetch: () => void,
) {
  recordFetch();

  return retrieveEvidence(story, fetcher);
}

function fairEvidenceOrder(
  candidates: Map<string, CandidateLead>,
  topics: Topic[],
) {
  const remaining = new Set(candidates.values());
  const ordered: CandidateLead[] = [];

  while (remaining.size > 0) {
    for (const topic of topics) {
      const candidate = [...remaining].find((lead) =>
        lead.topicIds.includes(topic.id),
      );

      if (candidate !== undefined) {
        ordered.push(candidate);
        remaining.delete(candidate);
      }
    }
  }

  return ordered;
}

function tierFor(
  story: StoryCandidate,
  evidence: BriefingCandidate['evidence'],
): BriefingCandidate['evidenceTier'] {
  if (evidence.status === 'usable') return 'article';

  if (evidence.pageKind === 'index-or-timeline') return 'headline-only';

  if (
    story.description !== undefined &&
    hasInformativeDescription(story.title, story.description.text)
  )
    return 'description';

  return 'headline-only';
}

function candidateDiagnostic(
  story: StoryCandidate,
  preferences: Preferences,
  topic: Topic,
  now: Date,
  queryIndex: number,
): BriefingCandidateDiagnostic {
  return {
    queryIndex,
    sourceUrl: story.sourceUrl,
    title: story.title.slice(0, 500),
    publisher: story.publisher?.slice(0, 500) ?? null,
    engines: (story.engines ?? []).slice(0, 20),
    publishedAt: story.publishedAt,
    dateProvenance: story.dateProvenance ?? 'unknown',
    outcome:
      rejectionReason(story, preferences, topic, now) ?? 'candidate-budget',
  };
}

function finishDiagnostics(
  diagnostics: BriefingDiagnostics,
  retained: Map<string, CandidateLead>,
  collected: BriefingCandidate[],
): void {
  const evidence = new Map(
    collected.map((candidate) => [candidate.story.sourceUrl, candidate]),
  );

  for (const metadata of diagnostics.candidates) {
    if (metadata.outcome !== 'candidate-budget') continue;
    const candidate = evidence.get(metadata.sourceUrl);

    if (candidate === undefined) {
      if (retained.has(metadata.sourceUrl))
        metadata.outcome = 'evidence-budget';
      continue;
    }
    metadata.outcome =
      candidate.evidence.status === 'unavailable' &&
      candidate.evidence.pageKind === 'index-or-timeline'
        ? 'non-article-page'
        : candidate.evidenceTier;

    if (candidate.evidence.status === 'usable') {
      metadata.evidenceCharacters = candidate.evidence.text.length;
      metadata.evidenceTruncated = candidate.evidence.truncated;
    } else {
      metadata.evidenceReason = candidate.evidence.reason.slice(0, 300);
    }
  }
}
