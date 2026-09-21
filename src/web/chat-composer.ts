/**
 * Keyboard intent for the chat composer. Plain Enter sends the question so a
 * follow-up needs no mouse, while Command/Ctrl+Enter adds a line to a longer
 * question. A touch-first device inverts that: Return adds a line and the Send
 * button submits, because a soft keyboard offers no way to hold a modifier.
 * Everything else, including Shift+Enter and an in-progress IME composition,
 * keeps the browser's own editing behavior.
 */
export type ComposerKeyAction = 'submit' | 'newline' | 'none';

/** Input-device facts that change what a key means. */
export type ComposerKeyOptions = {
  /** True when the primary pointer is a touch screen, where Return must not send. */
  coarsePointer?: boolean;
};

/** Classifies one composer keydown event without touching the DOM. */
export function composerKeyAction(
  event: {
    key: string;
    altKey: boolean;
    ctrlKey: boolean;
    metaKey: boolean;
    shiftKey: boolean;
    isComposing?: boolean;
  },
  options: ComposerKeyOptions = {},
): ComposerKeyAction {
  if (event.key !== 'Enter' || event.isComposing === true) return 'none';

  if (event.metaKey || event.ctrlKey) return 'newline';

  if (event.shiftKey || event.altKey) return 'none';

  if (options.coarsePointer === true) return 'newline';

  return 'submit';
}

/** Splices a line break into the composer value at the caret. */
export function insertLineBreak(
  value: string,
  caret: number,
  selectionEnd = caret,
): { value: string; caret: number } {
  const start = Math.max(0, Math.min(caret, value.length));
  const end = Math.max(start, Math.min(selectionEnd, value.length));
  const next = `${value.slice(0, start)}\n${value.slice(end)}`;

  return { value: next, caret: start + 1 };
}
