import { describe, expect, it } from 'vitest';
import { examplePreferences } from '../shared/preferences';
import {
  buildTopicProposalInput,
  parseTopicProposalResponse,
  topicProposalModel,
  topicProposalPromptVersion,
} from './topic-proposals';

const proposedTopic = {
  ...examplePreferences.topics[0],
  exclusions: ['Stock-price coverage'],
  summaryOverrides: { depth: 'concise' as const },
  userWording: 'Focus on official releases and practical developer tools.',
  searchConcepts: [{ terms: ['AI model releases'], intent: 'new releases' }],
};
const preferencesWithNarrative = {
  ...examplePreferences,
  topics: examplePreferences.topics.map((topic) =>
    topic.id === 'ai'
      ? {
          ...topic,
          userWording:
            'Prioritize official AI releases for practical developers and exclude stock-price coverage.',
        }
      : topic,
  ),
};

describe('topic proposal interpretation boundary', () => {
  it('uses the selected Workers AI topic-interpreter model', () => {
    expect(topicProposalModel).toBe('@cf/meta/llama-3.3-70b-instruct-fp8-fast');
  });

  it('enriches valid structured model output with server-owned identity and scope', () => {
    const result = parseTopicProposalResponse(
      {
        response: JSON.stringify({
          proposedTopic,
          explanation: 'Narrowed the AI topic to requested coverage.',
          unresolvedQuestions: [],
        }),
      },
      {
        request: 'Focus on official AI releases, not stock prices.',
        scope: { operation: 'edit-topic', topicId: 'ai' },
      },
      examplePreferences,
    );

    expect(result.proposal).toMatchObject({
      baseRevision: 0,
      scope: { operation: 'edit-topic', topicId: 'ai' },
      proposedTopic,
    });
    expect(result.proposal.id).not.toBe('');
    expect(result.promptVersion).toBe(topicProposalPromptVersion);
  });

  it('rejects duplicate IDs when a model tries to add an existing topic', () => {
    expect(() =>
      parseTopicProposalResponse(
        {
          response: JSON.stringify({
            proposedTopic,
            explanation: 'Added another AI topic.',
            unresolvedQuestions: [],
          }),
        },
        { request: 'Add AI', scope: { operation: 'add-topic' } },
        examplePreferences,
      ),
    ).toThrow('already exists');
  });

  it('accepts the object response returned by Workers AI JSON mode', () => {
    const result = parseTopicProposalResponse(
      {
        response: {
          proposedTopic,
          explanation: 'Uses the requested AI scope.',
          unresolvedQuestions: [],
        },
      },
      {
        request: 'Keep AI focused on releases.',
        scope: { operation: 'edit-topic', topicId: 'ai' },
      },
      examplePreferences,
    );

    expect(result.proposal.proposedTopic).toEqual(proposedTopic);
  });

  it('keeps global defaults outside the model request while preserving the target topic', () => {
    const input = buildTopicProposalInput(
      {
        request: 'Use concise technical bullets.',
        scope: { operation: 'edit-topic', topicId: 'ai' },
      },
      preferencesWithNarrative,
    );

    expect(JSON.stringify(input)).toContain('globalDefaults');
    expect(JSON.stringify(input)).toContain('Artificial intelligence');
    expect(JSON.stringify(input)).not.toContain('"topics"');
    expect(JSON.stringify(input)).toContain('"minItems":1');
    expect(JSON.stringify(input)).toContain('"const":"ai"');
    expect(JSON.stringify(input)).toContain(
      'Prioritize official AI releases for practical developers',
    );
    expect(input.messages[0]?.content).toContain(
      'currentTopic.userWording is the durable free-form preference narrative',
    );
    expect(input.messages[0]?.content).toContain(
      'durable free-form preference narrative',
    );
    expect(input.max_tokens).toBe(900);
  });

  it('rejects an empty required interest list from a model response', () => {
    expect(() =>
      parseTopicProposalResponse(
        {
          response: {
            proposedTopic: { ...proposedTopic, interests: [] },
            explanation: 'Removed all interests.',
            unresolvedQuestions: [],
          },
        },
        {
          request: 'Change the AI topic.',
          scope: { operation: 'edit-topic', topicId: 'ai' },
        },
        examplePreferences,
      ),
    ).toThrow();
  });

  it('rejects an empty preference narrative from a model response', () => {
    expect(() =>
      parseTopicProposalResponse(
        {
          response: {
            proposedTopic: { ...proposedTopic, userWording: '' },
            explanation: 'Changed the summary style.',
            unresolvedQuestions: [],
          },
        },
        {
          request: 'Use detailed explanations.',
          scope: { operation: 'add-topic' },
        },
        examplePreferences,
      ),
    ).toThrow('non-empty preference narrative');
  });

  it('rejects an edit that leaves the narrative unchanged', () => {
    const currentTopic = preferencesWithNarrative.topics.find(
      (topic) => topic.id === 'ai',
    );

    if (currentTopic === undefined)
      throw new Error('Expected the AI fixture topic.');

    expect(() =>
      parseTopicProposalResponse(
        {
          response: {
            proposedTopic: {
              ...currentTopic,
              summaryOverrides: { depth: 'detailed' },
            },
            explanation: 'Uses detailed explanations.',
            unresolvedQuestions: [],
          },
        },
        {
          request: 'Use detailed explanations.',
          scope: { operation: 'edit-topic', topicId: 'ai' },
        },
        preferencesWithNarrative,
      ),
    ).toThrow('must update the preference narrative');
  });

  it('accepts an edit that consolidates a style request into the narrative', () => {
    const currentTopic = preferencesWithNarrative.topics.find(
      (topic) => topic.id === 'ai',
    );

    if (currentTopic === undefined)
      throw new Error('Expected the AI fixture topic.');

    const result = parseTopicProposalResponse(
      {
        response: {
          proposedTopic: {
            ...currentTopic,
            userWording:
              'Prioritize official AI releases for practical developers, exclude stock-price coverage, and use detailed explanations.',
            summaryOverrides: { depth: 'detailed' },
          },
          explanation: 'Adds the requested detailed presentation preference.',
          unresolvedQuestions: [],
        },
      },
      {
        request: 'Use detailed explanations.',
        scope: { operation: 'edit-topic', topicId: 'ai' },
      },
      preferencesWithNarrative,
    );

    expect(result.proposal.proposedTopic.userWording).toContain(
      'use detailed explanations',
    );
  });
});
