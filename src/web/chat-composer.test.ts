import { describe, expect, it } from 'vitest';
import { composerKeyAction, insertLineBreak } from './chat-composer';

/** Builds one keydown shape with the modifiers a case cares about. */
function keydown(overrides: Partial<Parameters<typeof composerKeyAction>[0]>) {
  return {
    key: 'Enter',
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    ...overrides,
  };
}

describe('chat composer keys', () => {
  it('sends the question on Enter alone', () => {
    expect(composerKeyAction(keydown({}))).toBe('submit');
  });

  it('starts a new line on Command or Ctrl with Enter', () => {
    expect(composerKeyAction(keydown({ metaKey: true }))).toBe('newline');
    expect(composerKeyAction(keydown({ ctrlKey: true }))).toBe('newline');
  });

  it('leaves Shift/Alt+Enter and IME composition to the browser', () => {
    expect(composerKeyAction(keydown({ shiftKey: true }))).toBe('none');
    expect(composerKeyAction(keydown({ altKey: true }))).toBe('none');
    expect(composerKeyAction(keydown({ isComposing: true }))).toBe('none');
    expect(composerKeyAction(keydown({ key: 'a' }))).toBe('none');
  });

  it('inserts a line break at the caret and replaces the selection', () => {
    expect(insertLineBreak('first second', 5)).toEqual({
      value: 'first\n second',
      caret: 6,
    });
    expect(insertLineBreak('first second', 5, 12)).toEqual({
      value: 'first\n',
      caret: 6,
    });
  });

  it('clamps a caret outside the current value', () => {
    expect(insertLineBreak('ab', 99)).toEqual({ value: 'ab\n', caret: 3 });
    expect(insertLineBreak('ab', -5)).toEqual({ value: '\nab', caret: 1 });
  });
});
