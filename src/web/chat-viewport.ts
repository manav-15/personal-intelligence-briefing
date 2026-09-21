import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { isNearEnd, shouldFollow, type ReaderPosition } from './chat-scroll';

/** Reads the transcript's own scroll position. */
function readerPosition(element: HTMLElement): ReaderPosition {
  return {
    scrollHeight: element.scrollHeight,
    scrollTop: element.scrollTop,
    viewportHeight: element.clientHeight,
  };
}

/**
 * Keeps the transcript at its end while the reader is following it.
 *
 * The transcript is its own scroll container, so following moves that container
 * to its end rather than scrolling the page. Following ends only when the reader
 * scrolls the transcript away from the end, never because a message arrived, and
 * it resumes when they return to the end or press Jump to latest.
 *
 * `transcriptRef` is that container, which only exists once a conversation is
 * open, so `resetKey` both restarts following and re-attaches the scroll
 * listener when the reader opens another conversation. `revision` is any value
 * that changes when the transcript does.
 */
export function useChatFollow({
  resetKey,
  revision,
  transcriptRef,
}: {
  resetKey: string | null;
  revision: unknown;
  transcriptRef: React.RefObject<HTMLDivElement | null>;
}): { showJump: boolean; jumpToLatest: () => void } {
  const [showJump, setShowJump] = useState(false);
  const following = useRef(true);

  const scrollToEnd = useCallback(() => {
    const element = transcriptRef.current;

    if (element === null) return;

    element.scrollTop = element.scrollHeight;
  }, [transcriptRef]);

  useEffect(() => {
    const element = transcriptRef.current;

    if (element === null) return;

    function record() {
      const node = transcriptRef.current;

      if (node === null) return;

      const near = isNearEnd(readerPosition(node));

      following.current = near;
      setShowJump(!near);
    }

    element.addEventListener('scroll', record, { passive: true });

    return () => {
      element.removeEventListener('scroll', record);
    };
  }, [resetKey, transcriptRef]);

  // The composer grows and shrinks with the question, which resizes the
  // transcript; a reader who is following stays at the end through that.
  useEffect(() => {
    const element = transcriptRef.current;

    if (element === null) return;

    const observer = new ResizeObserver(() => {
      if (!following.current) return;

      scrollToEnd();
    });

    observer.observe(element);

    return () => {
      observer.disconnect();
    };
  }, [resetKey, scrollToEnd, transcriptRef]);

  useLayoutEffect(() => {
    following.current = true;
    scrollToEnd();
  }, [resetKey, scrollToEnd]);

  useLayoutEffect(() => {
    const element = transcriptRef.current;

    if (element === null) return;

    if (!shouldFollow(following.current, readerPosition(element))) return;

    scrollToEnd();
  }, [resetKey, revision, scrollToEnd, transcriptRef]);

  return { jumpToLatest: scrollToEnd, showJump };
}
