import { useEffect, useRef } from 'react';
import type { ChatSession } from '../shared/chat';

/** Everything the drawer's focus trap cycles through; disabled controls stay out of the order. */
const focusableSelector =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

type ConversationDrawerProps = {
  sessions: ChatSession[];
  activeSessionId: string | null;
  busy: boolean;
  onClose: () => void;
  onDelete: () => void;
  onNew: () => void;
  onOpen: (session: ChatSession) => void;
};

/**
 * Modal saved-conversation picker, with New conversation and Delete inside it.
 *
 * Conversations moved out of the transcript column so a phone screen belongs to
 * the messages. Focus enters the panel and cycles inside it; Escape and a
 * backdrop tap close it, and the screen returns focus to its opener.
 */
export function ConversationDrawer({
  activeSessionId,
  busy,
  onClose,
  onDelete,
  onNew,
  onOpen,
  sessions,
}: ConversationDrawerProps) {
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    panel.current?.querySelector<HTMLElement>(focusableSelector)?.focus();
  }, []);

  function handleKeys(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();

      return;
    }

    if (event.key !== 'Tab') return;

    const items =
      panel.current?.querySelectorAll<HTMLElement>(focusableSelector);
    const first = items?.[0];
    const last = items?.[items.length - 1];

    if (first === undefined || last === undefined) return;

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();

      return;
    }

    if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <div
      className="chat-drawer-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      onKeyDown={handleKeys}
    >
      <div
        aria-label="Saved conversations"
        aria-modal="true"
        className="chat-drawer"
        ref={panel}
        role="dialog"
      >
        <div className="chat-drawer-head">
          <h2>Saved conversations</h2>
          <button onClick={onClose} type="button">
            Close
          </button>
        </div>
        <button
          className="primary"
          disabled={busy}
          onClick={onNew}
          type="button"
        >
          New conversation
        </button>
        {sessions.length === 0 && <p>No saved conversations yet.</p>}
        <ul className="chat-drawer-list">
          {sessions.map((item) => (
            <li key={item.id}>
              <button
                aria-current={item.id === activeSessionId ? 'true' : undefined}
                disabled={busy}
                onClick={() => {
                  onOpen(item);
                }}
                type="button"
              >
                <span>{item.storyHeadline}</span>
                <small>
                  {item.briefingDate}
                  {item.id === activeSessionId ? ' · open now' : ''}
                </small>
              </button>
            </li>
          ))}
        </ul>
        {activeSessionId !== null && (
          <button
            className="danger"
            disabled={busy}
            onClick={onDelete}
            type="button"
          >
            Delete this conversation
          </button>
        )}
        <p className="chat-drawer-note">
          Each conversation is saved under its selected story and keeps the
          latest 200 messages. Older briefing editions stay here as conversation
          history until you delete them.
        </p>
      </div>
    </div>
  );
}
