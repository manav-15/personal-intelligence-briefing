/**
 * Keyboard intent for the chat composer. Plain Enter sends the question so a
 * follow-up needs no mouse, while Command/Ctrl+Enter adds a line to a longer
 * question. Everything else, including Shift+Enter and an in-progress IME
 * composition, keeps the browser's own editing behavior.
 */
export type ComposerKeyAction = 'submit' | 'newline' | 'none';

/** Classifies one composer keydown event without touching the DOM. */
export function composerKeyAction(event: {
  key: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  isComposing?: boolean;
}): ComposerKeyAction {
  if (event.key !== 'Enter' || event.isComposing === true) return 'none';

  if (event.metaKey || event.ctrlKey) return 'newline';

  if (event.shiftKey || event.altKey) return 'none';

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
