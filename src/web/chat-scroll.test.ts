import { describe, expect, it } from 'vitest';
import { isNearEnd, shouldFollow, type ReaderPosition } from './chat-scroll';

/** Builds the reading position that sits `distance` pixels above the end of the transcript. */
function position(distance: number): ReaderPosition {
  return {
    scrollHeight: 4_000,
    scrollTop: 3_000 - distance,
    viewportHeight: 1_000,
  };
}

describe('chat follow position', () => {
  it('counts the reader as following at the end and up to the threshold', () => {
    expect(isNearEnd(position(0))).toBe(true);
    expect(isNearEnd(position(120))).toBe(true);
  });

  it('stops counting one pixel beyond the threshold', () => {
    expect(isNearEnd(position(121))).toBe(false);
  });

  it('counts a transcript shorter than its window as at the end', () => {
    expect(
      isNearEnd({ scrollHeight: 600, scrollTop: 0, viewportHeight: 900 }),
    ).toBe(true);
  });

  it('keeps following when the transcript reloads under a reader at the end', () => {
    expect(shouldFollow(true, position(800))).toBe(true);
  });

  it('leaves a reader who scrolled away where they are', () => {
    expect(shouldFollow(false, position(800))).toBe(false);
  });

  it('resumes following once the reader returns to the end', () => {
    expect(shouldFollow(false, position(40))).toBe(true);
  });
});
