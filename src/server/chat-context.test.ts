import { describe, expect, it } from 'vitest';
import { exampleBriefing } from '../shared/briefings.test';
import {
  buildBriefingChatContext,
  chatSources,
  ensureChatCitation,
  parseChatModelResponse,
  parseChatRequest,
} from './chat-context';

describe('briefing chat context', () => {
  it('makes only the selected story and its code-owned sources available', () => {
    const context = buildBriefingChatContext(
      exampleBriefing,
      'ai-model-release',
    );

    if (context === null)
      throw new Error('Expected selected chat story context.');

    expect(context.system).toContain('Example AI model release');
    expect(context.system).toContain('[S1] Example Publisher | article');
    expect(context.system).toContain('Do not use outside knowledge');
    expect(chatSources(context.item)).toEqual([
      {
        evidenceTier: 'article',
        label: 'S1',
        publisher: 'Example Publisher',
        sourceUrl: 'https://example.com/ai-model-release',
      },
    ]);
  });

  it('supplies retained article text with its retrieval time and source label', () => {
    const context = buildBriefingChatContext(
      exampleBriefing,
      'ai-model-release',
      [
        {
          sourceUrl: 'https://example.com/ai-model-release',
          publisher: 'Example Publisher',
          evidenceTier: 'article',
          retrievedAt: '2026-09-19T06:00:00.000Z',
          characters: 61,
          truncated: false,
          text: 'Example Lab said the release adds a larger context window.',
        },
      ],
    );

    if (context === null)
      throw new Error('Expected selected chat story context.');

    expect(context.system).toContain('Retrieved article text');
    expect(context.system).toContain(
      '[S1] retrieved 2026-09-19T06:00:00.000Z: Example Lab said the release adds a larger context window.',
    );
    expect(context.system).toContain('bounded extract');
  });

  it('states that no article text was retained instead of implying it exists', () => {
    const context = buildBriefingChatContext(
      exampleBriefing,
      'ai-model-release',
    );

    if (context === null)
      throw new Error('Expected selected chat story context.');

    expect(context.system).toContain('none was retained for this story');
    expect(context.system).not.toContain('Retrieved article text from');
  });

  it('bounds the retained text it supplies across sources', () => {
    const item = exampleBriefing.items[0];

    if (item === undefined) throw new Error('Expected a fixture story.');
    const context = buildBriefingChatContext(
      exampleBriefing,
      item.id,
      item.citations.map((citation) => ({
        sourceUrl: citation.sourceUrl,
        publisher: citation.publisher,
        evidenceTier: citation.evidenceTier,
        retrievedAt: '2026-09-19T06:00:00.000Z',
        characters: 20_000,
        truncated: true,
        text: 'x'.repeat(20_000),
      })),
    );

    if (context === null)
      throw new Error('Expected selected chat story context.');
    const supplied =
      context.system.split('Retrieved article text from')[1] ?? '';

    expect(supplied.length).toBeLessThan(12_300);
    expect(supplied).toContain('(first 12000 characters)');
  });

  it('rejects unknown or malformed story selection without exposing another story', () => {
    expect(buildBriefingChatContext(exampleBriefing, 'missing')).toBeNull();
    expect(
      parseChatRequest({
        sessionId: exampleBriefing.runId,
      }),
    ).toEqual({
      sessionId: exampleBriefing.runId,
    });
    expect(
      parseChatRequest({
        sessionId: 'not-a-uuid',
        extra: true,
      }),
    ).toBeNull();
    expect(parseChatRequest(undefined)).toBeNull();
  });

  it('accepts only a bounded non-empty Workers AI response', () => {
    expect(parseChatModelResponse({ response: 'Grounded answer [S1].' })).toBe(
      'Grounded answer [S1].',
    );
    expect(parseChatModelResponse({ response: '' })).toBeNull();
    expect(parseChatModelResponse({ answer: 'Wrong field' })).toBeNull();
  });

  it('adds a code-owned source label when a model answer omits one', () => {
    const item = exampleBriefing.items[0];

    if (item === undefined) throw new Error('Expected a fixture story.');
    expect(ensureChatCitation('A grounded answer.', item)).toBe(
      'A grounded answer. [S1]',
    );
    expect(ensureChatCitation('A grounded answer [S1].', item)).toBe(
      'A grounded answer [S1].',
    );
  });
});
