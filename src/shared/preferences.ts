import { z } from 'zod';

const text = z.string().trim().min(1).max(1_000);
const phrases = z.array(text).max(20);
const httpsUrl = z
  .url()
  .refine((value) => new URL(value).protocol === 'https:');

/** Summary controls that can be inherited or overridden by an individual topic. */
export const summaryPreferencesSchema = z.strictObject({
  format: z.enum(['bullets', 'paragraphs']),
  depth: z.enum(['concise', 'standard', 'detailed']),
  audience: text,
  emphasis: phrases,
  instructions: z.string().trim().max(2_000),
});

/** Source preferences; blocked sources remain mandatory when topic values inherit. */
export const sourcePreferencesSchema = z.strictObject({
  preferred: z.array(httpsUrl).max(20),
  blocked: z.array(httpsUrl).max(20),
  officialFirst: z.boolean(),
});

/** Provider-neutral discovery intent, distinct from user wording and final query strings. */
export const searchConceptSchema = z.strictObject({
  terms: phrases.min(1),
  intent: text,
});

/** Independently configurable interest area with optional inherited presentation/source values. */
export const topicSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/u),
  name: z.string().trim().min(1).max(120),
  enabled: z.boolean(),
  interests: phrases.min(1),
  exclusions: phrases,
  userWording: z.string().trim().max(4_000),
  summaryOverrides: summaryPreferencesSchema.partial(),
  sourceOverrides: sourcePreferencesSchema.partial(),
  searchConcepts: z.array(searchConceptSchema).max(8),
});

const globalPreferencesSchema = z.strictObject({
  schedule: z.strictObject({
    localTime: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/u),
    timezone: z.string().refine((value) => {
      try {
        new Intl.DateTimeFormat('en', { timeZone: value });

        return true;
      } catch {
        return false;
      }
    }, 'Use a recognized timezone'),
  }),
  reading: z
    .strictObject({
      targetMinutes: z.number().int().min(1).max(30),
      minStories: z.number().int().min(1).max(30),
      maxStories: z.number().int().min(1).max(30),
    })
    .refine((value) => value.minStories <= value.maxStories),
  summary: summaryPreferencesSchema,
  sources: sourcePreferencesSchema,
  exclusions: phrases,
});

/** Versioned singleton document for later Agent-owned SQLite persistence. */
export const preferencesSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    revision: z.number().int().nonnegative(),
    global: globalPreferencesSchema,
    topics: z.array(topicSchema).max(30),
  })
  .refine(
    (value) =>
      new Set(value.topics.map((topic) => topic.id)).size ===
      value.topics.length,
    'Topic IDs must be unique',
  );

/** A reviewable, topic-scoped LLM proposal. Application occurs in a later slice. */
export const topicProposalSchema = z
  .strictObject({
    id: z.string().min(1).max(100),
    baseRevision: z.number().int().nonnegative(),
    request: text,
    scope: z.discriminatedUnion('operation', [
      z.strictObject({ operation: z.literal('add-topic') }),
      z.strictObject({
        operation: z.literal('edit-topic'),
        topicId: topicSchema.shape.id,
      }),
    ]),
    proposedTopic: topicSchema,
    explanation: text,
    unresolvedQuestions: phrases,
  })
  .refine(
    (value) =>
      value.scope.operation === 'add-topic' ||
      value.scope.topicId === value.proposedTopic.id,
    'An edit must preserve the selected topic ID',
  );

/** Complete, runtime-validated preference document. */
export type Preferences = z.infer<typeof preferencesSchema>;
/** One independently managed interest configuration. */
export type Topic = z.infer<typeof topicSchema>;

/** Resolves inherited topic settings without allowing topic settings to weaken global restrictions. */
export function effectiveTopicPreferences(
  preferences: Preferences,
  topic: Topic,
) {
  return {
    summary: { ...preferences.global.summary, ...topic.summaryOverrides },
    sources: {
      ...preferences.global.sources,
      ...topic.sourceOverrides,
      blocked: [
        ...new Set([
          ...preferences.global.sources.blocked,
          ...(topic.sourceOverrides.blocked ?? []),
        ]),
      ],
    },
    exclusions: [
      ...new Set([...preferences.global.exclusions, ...topic.exclusions]),
    ],
  };
}

/** Initial design example used for fixtures and the later first-run experience. */
export const examplePreferences = preferencesSchema.parse({
  schemaVersion: 1,
  revision: 0,
  global: {
    schedule: { localTime: '08:00', timezone: 'Asia/Kolkata' },
    reading: { targetMinutes: 5, minStories: 8, maxStories: 10 },
    summary: {
      format: 'bullets',
      depth: 'concise',
      audience: 'General reader',
      emphasis: ['What happened', 'Why it matters'],
      instructions: '',
    },
    sources: { preferred: [], blocked: [], officialFirst: false },
    exclusions: [],
  },
  topics: [
    {
      id: 'ai',
      name: 'Artificial intelligence',
      interests: ['Model releases', 'Developer tools'],
    },
    {
      id: 'world',
      name: 'World news & geopolitics',
      interests: ['Major worldwide developments', 'Geopolitics'],
    },
    {
      id: 'liverpool',
      name: 'Liverpool & Premier League',
      interests: ['Liverpool FC', 'Premier League'],
    },
  ].map((topic) => ({
    ...topic,
    enabled: true,
    exclusions: [],
    userWording: '',
    summaryOverrides: {},
    sourceOverrides: {},
    searchConcepts: [],
  })),
});
