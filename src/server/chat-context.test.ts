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
