import { z } from 'zod';

const provider = z.enum(['searxng', 'google-news', 'gdelt']);
const topicId = z.string().min(1).max(64);

/** Small per-request counts distinguish empty discovery from failed discovery. */
export const briefingQueryDiagnosticSchema = z.strictObject({
  topicId,
  provider,
  query: z.string().max(4_000),
  status: z.enum(['ok', 'partial', 'failed']),
  returned: z.number().int().min(0).max(25),
  failureCount: z.number().int().min(0).max(1_000),
});

/** Metadata for one returned discovery occurrence; never includes article or snippet text. */
export const briefingCandidateDiagnosticSchema = z.strictObject({
  queryIndex: z.number().int().min(0).max(59),
  sourceUrl: z.url().max(2_000),
  title: z.string().max(500),
  publisher: z.string().max(500).nullable(),
  engines: z.array(z.string().min(1).max(120)).max(20).default([]),
  publishedAt: z.iso.datetime().nullable(),
  dateProvenance: z
    .enum([
      'search-metadata',
      'publisher-jsonld',
      'publisher-meta',
      'publisher-time',
      'unknown',
    ])
    .optional(),
  outcome: z.enum([
    'unknown-date',
    'future-date',
    'stale',
    'blocked-source',
    'excluded',
    'candidate-budget',
    'evidence-budget',
    'article',
    'description',
    'headline-only',
    'non-article-page',
  ]),
  evidenceCharacters: z.number().int().nonnegative().optional(),
  evidenceTruncated: z.boolean().optional(),
  evidenceReason: z.string().max(300).optional(),
});

/** Bounded retained collection trace; occurrences may repeat a URL across queries/topics. */
export const briefingDiagnosticsSchema = z.strictObject({
  schemaVersion: z.literal(1),
  collectedAt: z.iso.datetime(),
  queries: z.array(briefingQueryDiagnosticSchema).max(60),
  candidates: z.array(briefingCandidateDiagnosticSchema).max(1_500),
});

/** Local diagnostic response separates collection metadata from publication selection. */
export const briefingDiagnosticsResponseSchema = z.strictObject({
  diagnostics: briefingDiagnosticsSchema.nullable(),
  publishedSourceUrls: z.array(z.url().max(2_000)).max(300).nullable(),
});

/** Validated collection trace retained after temporary evidence is deleted. */
export type BriefingDiagnostics = z.infer<typeof briefingDiagnosticsSchema>;
/** A returned candidate's bounded metadata and collection disposition. */
export type BriefingCandidateDiagnostic = z.infer<
  typeof briefingCandidateDiagnosticSchema
>;
