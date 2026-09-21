import { z } from 'zod';

const text = z.string().trim().min(1).max(2_000);
const topicId = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/u);
const sourceUrl = z
  .url()
  .max(2_000)
  .refine((value) => ['http:', 'https:'].includes(new URL(value).protocol));

/** Evidence strength disclosed with every published source citation. */
export const evidenceTierSchema = z.enum([
  'article',
  'description',
  'headline-only',
]);

/** A source that supports one briefing item without retaining its full article text. */
export const briefingCitationSchema = z.strictObject({
  sourceUrl,
  publisher: z.string().trim().min(1).max(500).nullable(),
  evidenceTier: evidenceTierSchema,
});

/** Identifies a previously published item that a new item materially updates. */
export const briefingUpdateReferenceSchema = z.strictObject({
  runId: z.uuid(),
  itemId: z.string().trim().min(1).max(200),
});

/** Discloses a supported material change from earlier briefing coverage. */
export const briefingItemUpdateSchema = z.strictObject({
  previousItems: z.array(briefingUpdateReferenceSchema).min(1).max(12),
  whatChanged: text.max(1_000),
});

/** Records the bounded model policy used to compose a published briefing. */
export const briefingCompositionProvenanceSchema = z.strictObject({
  model: z.string().trim().min(1).max(200),
  promptVersion: z.string().trim().min(1).max(100),
  evidencePolicyVersion: z.string().trim().min(1).max(100),
  composedAt: z.iso.datetime(),
});

/** A cited, topic-attributed story included in a published briefing. */
export const briefingItemSchema = z.strictObject({
  id: z.string().trim().min(1).max(200),
  topicIds: z.array(topicId).min(1).max(30),
  headline: text.max(500),
  summary: text,
  publishedAt: z.iso.datetime().nullable(),
  citations: z.array(briefingCitationSchema).min(1).max(10),
  update: briefingItemUpdateSchema.optional(),
});

/** A clearly disclosed limitation from a partial briefing run. */
export const briefingLimitationSchema = z.strictObject({
  code: z.string().trim().min(1).max(100),
  message: text,
});

/** Immutable published briefing payload stored by the Agent. */
export const briefingSchema = z.strictObject({
  schemaVersion: z.literal(1),
  runId: z.uuid(),
  date: z.iso.date(),
  preferenceRevision: z.number().int().nonnegative(),
  topicNames: z.record(z.string(), z.string().max(120)).optional(),
  completeness: z.enum(['complete', 'partial']),
  limitations: z.array(briefingLimitationSchema).max(50),
  items: z.array(briefingItemSchema).min(1).max(30),
  publishedAt: z.iso.datetime(),
  composition: briefingCompositionProvenanceSchema.optional(),
});

/** Minimal metadata used to render the briefing archive without loading every item. */
export const briefingArchiveEntrySchema = z.strictObject({
  runId: briefingSchema.shape.runId,
  date: briefingSchema.shape.date,
  completeness: briefingSchema.shape.completeness,
  itemCount: z.number().int().nonnegative(),
  publishedAt: briefingSchema.shape.publishedAt,
});

/** Lifecycle state retained separately from the immutable published payload. */
export const briefingRunStatusSchema = z.enum([
  'running',
  'published',
  'failed',
]);

/** A persisted, attributable collection problem shown when a run cannot complete. */
export const briefingRunFailureSchema = z.strictObject({
  stage: z.enum(['discovery', 'evidence', 'budget']),
  // Persisted provenance vocabulary; only searxng is produced since DISC-10.
  provider: z.enum(['searxng', 'google-news', 'gdelt']).nullable(),
  message: z.string().trim().min(1).max(1_000),
});

/** Server-owned status for one manually requested briefing generation run. */
export const briefingRunStatusResponseSchema = z.strictObject({
  runId: z.uuid(),
  status: briefingRunStatusSchema,
  failureMessage: z.string().trim().min(1).max(1_000).nullable(),
  collectionFailures: z.array(briefingRunFailureSchema).max(200),
});

/** Acknowledges a newly created or already-active manual briefing workflow. */
export const briefingGenerationResponseSchema = z.strictObject({
  runId: z.uuid(),
  created: z.boolean(),
});

/** Creates one idempotent run snapshot before collection begins. */
export const briefingRunInputSchema = z.strictObject({
  runId: z.uuid(),
  preferenceRevision: z.number().int().nonnegative(),
});

/** Response contract for the newest published briefing. */
export const latestBriefingSchema = z.strictObject({
  briefing: briefingSchema.nullable(),
});

/** Response contract for ordered briefing archive metadata. */
export const briefingArchiveSchema = z.strictObject({
  briefings: z.array(briefingArchiveEntrySchema),
});

/** One fully validated published briefing. */
export type Briefing = z.infer<typeof briefingSchema>;
/** One cited item in an immutable published briefing. */
export type BriefingItem = z.infer<typeof briefingItemSchema>;
/** One archive row without full item payloads. */
export type BriefingArchiveEntry = z.infer<typeof briefingArchiveEntrySchema>;
/** Validated input for an idempotent briefing run. */
export type BriefingRunInput = z.infer<typeof briefingRunInputSchema>;
/** A safe-to-render status view for a manual generation run. */
export type BriefingRunStatusResponse = z.infer<
  typeof briefingRunStatusResponseSchema
>;
