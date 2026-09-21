/**
 * Follow behaviour for the transcript's own scroll container.
 *
 * The transcript scrolls inside the chat column rather than with the page, so
 * following means moving that container to its end. A reader who is at the end
 * keeps receiving new messages, and a reader who has scrolled away stays where
 * they are until they return or press Jump to latest.
 */

/** The reader's position inside the transcript's scroll container. */
export type ReaderPosition = {
  /** Pixels the transcript is scrolled by. */
  scrollTop: number;
  /** Full scrollable height of the transcript. */
  scrollHeight: number;
  /** Visible height of the transcript. */
  viewportHeight: number;
};

/** Pixels from the end of the transcript within which the reader counts as following. */
export const nearEndThreshold = 120;

/** Decides whether the reader sits within the threshold of the transcript's end. */
export function isNearEnd(
  position: ReaderPosition,
  threshold = nearEndThreshold,
): boolean {
  return distanceFromEnd(position) <= threshold;
}

/**
 * Decides whether a content update may move the reader.
 *
 * `following` is the state recorded before the update, so a transcript that
 * reloads under a reader who was at the end does not silently stop following.
 */
export function shouldFollow(
  following: boolean,
  position: ReaderPosition,
  threshold = nearEndThreshold,
): boolean {
  return following || isNearEnd(position, threshold);
}

/** Distance between the reader's viewport bottom and the end, clamped for a short transcript. */
function distanceFromEnd({
  scrollHeight,
  scrollTop,
  viewportHeight,
}: ReaderPosition): number {
  return Math.max(0, scrollHeight - scrollTop - viewportHeight);
}
