import { z } from 'zod';

/** Supported discovery channels across the Worker and content inspector. */
export const discoveryProviderSchema = z.enum([
  'google-news',
  'gdelt',
  'searxng',
]);

/** Attributed description metadata; it must not be presented as article text. */
export const descriptionSchema = z.object({
  text: z.string().max(2000),
  kind: z.enum(['search-snippet', 'publisher-feed', 'publisher-metadata']),
  provider: discoveryProviderSchema,
  observedAt: z.iso.datetime(),
});

/** A trustworthy publisher-supplied publication date recovered from article markup. */
export const publisherDateSchema = z.object({
  publishedAt: z.iso.datetime(),
  provenance: z.enum(['publisher-jsonld', 'publisher-meta', 'publisher-time']),
});

/** Runtime-validated normalized story contract used in inspector requests/results. */
export const storyCandidateSchema = z.object({
  id: z.string().min(1).max(2000),
  title: z.string().trim().min(1).max(500),
  publisher: z.string().nullable(),
  publishedAt: z.iso.datetime().nullable(),
  sourceUrl: z
    .url()
    .max(2000)
    .refine((value) => ['http:', 'https:'].includes(new URL(value).protocol)),
  discoveryUrl: z
    .url()
    .max(2000)
    .refine((value) => ['http:', 'https:'].includes(new URL(value).protocol))
    .optional(),
  discovery: discoveryProviderSchema,
  description: descriptionSchema.optional(),
  engines: z.array(z.string()).optional(),
  dateProvenance: z
    .enum([
      'search-metadata',
      'publisher-jsonld',
      'publisher-meta',
      'publisher-time',
      'unknown',
    ])
    .optional(),
});

/** Explicit collection failures, including partial upstream engine failures. */
export const discoveryFailureSchema = z.object({
  code: z.enum([
    'feed-fetch-failed',
    'feed-too-large',
    'invalid-feed',
    'provider-fetch-failed',
    'provider-rate-limited',
    'response-too-large',
    'invalid-response',
    'provider-engine-failed',
  ]),
  message: z.string(),
});

/** Mechanical retrieval outcome; extracted text still requires quality review. */
export const evidenceSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('usable'),
    articleUrl: z.url(),
    text: z.string(),
    truncated: z.boolean(),
    provenance: z.literal('publisher-page'),
    pageTitle: z.string(),
    extraction: z.enum(['article-region', 'paragraphs']),
    publicationDate: publisherDateSchema.optional(),
  }),
  z.object({
    status: z.literal('unavailable'),
    reason: z.string(),
    publicationDate: publisherDateSchema.optional(),
    pageKind: z.literal('index-or-timeline').optional(),
  }),
]);

/** User-controlled bounded keyword query; this is not natural-language interpretation. */
export const inspectionSearchSchema = z.object({
  query: z.string().trim().min(2).max(200),
  maxResults: z.number().int().min(1).max(15).default(10),
  timeRange: z.enum(['any', 'day', 'month', 'year']).default('any'),
});

/** Search diagnostics returned without automatically fetching publisher pages. */
export const inspectionSearchResponseSchema = z.object({
  query: z.string(),
  observedAt: z.iso.datetime(),
  timeRange: inspectionSearchSchema.shape.timeRange,
  dateFilter: z
    .object({
      from: z.iso.datetime(),
      to: z.iso.datetime(),
      excluded: z.number().int().nonnegative(),
      undated: z.number().int().nonnegative(),
    })
    .optional(),
  stories: z.array(storyCandidateSchema),
  failures: z.array(discoveryFailureSchema),
});

/** Explicit evidence tier and retained article-retrieval failure for one result. */
export const inspectionEvidenceResponseSchema = z.object({
  evidence: evidenceSchema,
  tier: z.enum(['article', 'description', 'headline-only']),
  fallbackDescription: descriptionSchema.nullable(),
});

/** Normalized story shared by browser and server modules. */
export type StoryCandidate = z.infer<typeof storyCandidateSchema>;
/** Provider result used by discovery implementations. */
export type DiscoveryResult = {
  dateFilter?: z.infer<typeof inspectionSearchResponseSchema>['dateFilter'];
  stories: StoryCandidate[];
  failures: z.infer<typeof discoveryFailureSchema>[];
};
/** Inspector's validated search result. */
export type InspectionSearchResult = z.infer<
  typeof inspectionSearchResponseSchema
>;
/** Inspector's validated evidence result. */
export type InspectionEvidenceResult = z.infer<
  typeof inspectionEvidenceResponseSchema
>;
