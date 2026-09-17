import { describe, expect, it } from 'vitest';
import {
  effectiveTopicPreferences,
  examplePreferences,
  preferencesSchema,
  topicProposalSchema,
} from './preferences';

describe('preferences contracts', () => {
  it('round-trips independent topics and user-controlled wording', () => {
    const value = structuredClone(examplePreferences);
    value.global.summary.instructions = 'Focus on operational impact.';
    expect(preferencesSchema.parse(JSON.parse(JSON.stringify(value)))).toEqual(
      value,
    );
  });
  it('inherits defaults without weakening global restrictions', () => {
    const value = structuredClone(examplePreferences);
    const topic = value.topics[0];
    if (!topic) throw new Error('Missing topic');
    value.global.exclusions = ['Stock prices'];
    value.global.sources.blocked = ['https://blocked.example/'];
    topic.summaryOverrides = { emphasis: ['Developer impact'] };
    topic.sourceOverrides = { blocked: [] };
    expect(effectiveTopicPreferences(value, topic)).toMatchObject({
      summary: { depth: 'concise', emphasis: ['Developer impact'] },
      exclusions: ['Stock prices'],
      sources: { blocked: ['https://blocked.example/'] },
    });
  });
  it('rejects duplicate IDs, invalid times, and proposals outside the selected topic', () => {
    expect(
      preferencesSchema.safeParse({
        ...examplePreferences,
        topics: [...examplePreferences.topics, examplePreferences.topics[0]],
      }).success,
    ).toBe(false);
    expect(
      preferencesSchema.safeParse({
        ...examplePreferences,
        global: {
          ...examplePreferences.global,
          schedule: { localTime: '25:00', timezone: 'Nope/Nope' },
        },
      }).success,
    ).toBe(false);
    const proposal = {
      id: 'p1',
      baseRevision: 0,
      request: 'Shorter AI updates',
      scope: { operation: 'edit-topic' as const, topicId: 'ai' },
      proposedTopic: examplePreferences.topics[0],
      explanation: 'Shorter',
      unresolvedQuestions: [],
    };
    expect(topicProposalSchema.safeParse(proposal).success).toBe(true);
    expect(
      topicProposalSchema.safeParse({
        ...proposal,
        scope: { operation: 'edit-topic', topicId: 'world' },
      }).success,
    ).toBe(false);
  });
});
