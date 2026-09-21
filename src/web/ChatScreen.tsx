import { useAgent } from 'agents/react';
import { useAgentChat } from '@cloudflare/ai-chat/react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ChatMessage, ChatSession } from '../shared/chat';
import type { Briefing, BriefingItem } from '../shared/briefings';
import { composerKeyAction, insertLineBreak } from './chat-composer';
import { useChatFollow } from './chat-viewport';
import { evidenceSummary } from './chat-sources';
import { ConversationDrawer } from './ChatDrawer';
import {
  createChatSession,
  deleteChatSession,
  listChatSessions,
  readChatSession,
} from './chats-client';
import {
  listBriefingArchive,
  readArchivedBriefing,
  readTodayBriefing,
} from './briefings-client';
import { readOwnerId } from './identity-client';

/**
 * Renders source-grounded conversations that remain available after a browser reload.
 *
 * The transport cannot start before the Worker's resolved owner is known: an
 * unnamed connection would address a different Durable Object instance.
 */
export function ChatScreen() {
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [ownerFailed, setOwnerFailed] = useState(false);

  useEffect(() => {
    let active = true;

    void readOwnerId()
      .then((resolved) => {
        if (active) setOwnerId(resolved);
      })
      .catch(() => {
        if (active) setOwnerFailed(true);
      });

    return () => {
      active = false;
    };
  }, []);

  if (ownerFailed)
    return (
      <section className="chat-screen" role="alert">
        <h1>Couldn’t start chat</h1>
        <p>Return to Today, then try Chat again.</p>
      </section>
    );

  if (ownerId === null)
    return (
      <section className="chat-screen" aria-busy="true">
        <p className="eyebrow" role="status">
          Connecting to your briefing…
        </p>
        <h1>Ask about your briefing</h1>
      </section>
    );

  return <ChatConversation ownerId={ownerId} />;
}

/** Owns the Agent transport for one resolved owner. */
function ChatConversation({ ownerId }: { ownerId: string }) {
  const [briefing, setBriefing] = useState<Briefing | null | undefined>(
    undefined,
  );
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [session, setSession] = useState<ChatSession | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loadFailed, setLoadFailed] = useState(false);
  const [selectedStoryId, setSelectedStoryId] = useState('');
  const [input, setInput] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  const [changingConversation, setChangingConversation] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const actionVersion = useRef(0);
  const actionPending = useRef(false);
  const conversationsButton = useRef<HTMLButtonElement>(null);
  const drawerWasOpen = useRef(false);
  const question = useRef<HTMLTextAreaElement>(null);
  const transcript = useRef<HTMLDivElement>(null);
  const agent = useAgent({ agent: 'personal-briefing', name: ownerId });
  const {
    isRecovering,
    isStreaming,
    messages: transportMessages,
    sendMessage,
    error: transportError,
  } = useAgentChat({ agent, body: () => ({ sessionId: session?.id }) });
  const selectedStory = briefing?.items.find(
    (story) => story.id === selectedStoryId,
  );
  const busy = isStreaming || isRecovering || changingConversation;
  const detachedSession = isDetachedSession(session);
  const composer = chatComposerState(busy, detachedSession);
  const { jumpToLatest, showJump } = useChatFollow({
    resetKey: session?.id ?? null,
    revision: messages,
    transcriptRef: transcript,
  });

  // The composer starts at one line and grows with the question, up to the
  // bound in CSS. Border widths are added back because the box is border-box.
  useLayoutEffect(() => {
    const element = question.current;

    if (element === null) return;

    element.style.height = 'auto';
    const borders = element.offsetHeight - element.clientHeight;

    element.style.height = `${String(element.scrollHeight + borders)}px`;
  }, [input]);

  useEffect(() => {
    void loadChatData()
      .then(({ edition, sessions: stored }) => {
        setBriefing(edition);
        setSessions(stored);
        setSelectedStoryId(edition?.items[0]?.id ?? '');
      })
      .catch(() => {
        setLoadFailed(true);
      });
  }, []);

  // The drawer unmounts before its own cleanup can hold focus, so the screen
  // returns focus to the button that opened it once the drawer is gone.
  useEffect(() => {
    if (drawerWasOpen.current && !drawerOpen)
      conversationsButton.current?.focus();

    drawerWasOpen.current = drawerOpen;
  }, [drawerOpen]);

  useEffect(() => {
    if (session === null || transportMessages.length === 0) return;

    let active = true;
    const version = actionVersion.current;

    void refreshSession(session.id, (history) => {
      if (active && version === actionVersion.current) setMessages(history);
    });

    return () => {
      active = false;
    };
  }, [session, transportMessages.length, isStreaming, isRecovering]);

  async function changeConversation(action: () => Promise<void>) {
    if (actionPending.current || isStreaming || isRecovering) return;
    actionPending.current = true;
    actionVersion.current += 1;
    setChangingConversation(true);
    setActionError(null);

    try {
      await action();
    } catch (error) {
      setActionError(
        error instanceof Error
          ? error.message
          : 'Could not update this conversation. Please try again.',
      );
    } finally {
      actionPending.current = false;
      setChangingConversation(false);
    }
  }

  async function startConversation() {
    if (
      briefing === null ||
      briefing === undefined ||
      selectedStory === undefined
    )
      return;

    const created = await createChatSession(briefing.runId, selectedStory.id);

    setSessions((current) => [created, ...current]);
    setSession(created);
    setMessages([]);
  }

  async function openConversation(nextSession: ChatSession) {
    if (nextSession.briefingRunId === null) {
      const history = await readChatSession(nextSession.id);

      setSelectedStoryId(nextSession.storyId);
      setSession(history.session);
      setMessages(history.messages);
      setActionError(
        'This briefing was deleted. Its saved messages remain available, but its source context is gone.',
      );

      return;
    }

    const [history, edition] = await Promise.all([
      readChatSession(nextSession.id),
      readArchivedBriefing(nextSession.briefingRunId),
    ]);

    if (edition === null)
      throw new Error('The briefing for this chat is unavailable.');

    setBriefing(edition);
    setSelectedStoryId(nextSession.storyId);
    setSession(history.session);
    setMessages(history.messages);
  }

  async function removeConversation() {
    if (session === null) return;

    if (
      !window.confirm(
        'Delete this conversation? Its messages cannot be recovered.',
      )
    )
      return;

    await deleteChatSession(session.id);
    setSessions((current) => current.filter((item) => item.id !== session.id));
    setSession(null);
    setMessages([]);
    setDrawerOpen(false);
  }

  async function beginNewConversation() {
    const edition = await loadChatBriefing();

    setBriefing(edition);
    setSelectedStoryId(edition?.items[0]?.id ?? '');
    setSession(null);
    setMessages([]);
  }

  function submit(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const question = input.trim();

    if (!question || session === null || busy) return;

    setActionError(null);
    void sendMessage({
      role: 'user',
      parts: [{ type: 'text', text: question }],
    }).catch(() => {
      setInput(question);
      setActionError('Your question could not be sent. Please try again.');
    });
    setMessages((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        role: 'user',
        content: question,
        createdAt: new Date().toISOString(),
      },
    ]);
    setInput('');
  }

  if (loadFailed)
    return (
      <section className="chat-screen" role="alert">
        <h1>Couldn’t load saved conversations</h1>
        <p>Return to Today, then try Chat again.</p>
      </section>
    );

  if (briefing === undefined)
    return (
      <section className="chat-screen" aria-busy="true">
        <p className="eyebrow" role="status">
          Loading story context…
        </p>
        <h1>Ask about your briefing</h1>
      </section>
    );

  if (briefing === null || briefing.items.length === 0)
    return (
      <section className="chat-screen">
        <p className="eyebrow">Grounded follow-ups</p>
        <h1>Ask after your next briefing</h1>
        <p className="intro">
          Chat uses a selected cited story from a saved edition. Generate a
          briefing first so there is source context to discuss.
        </p>
      </section>
    );

  return (
    <section className="chat-screen">
      <div className="chat-shell" inert={drawerOpen}>
        <header className="chat-head">
          <h1>Chat</h1>
          <button
            aria-expanded={drawerOpen}
            aria-haspopup="dialog"
            className="chat-conversations"
            onClick={() => {
              setDrawerOpen(true);
            }}
            ref={conversationsButton}
            type="button"
          >
            Conversations
            <small>{sessions.length}</small>
          </button>
        </header>
        {(actionError !== null || transportError !== undefined) && (
          <p className="chat-alert" role="alert">
            {actionError ??
              'The answer could not be completed. Check your connection and try your question again.'}
          </p>
        )}
        {/* The one scrolling region: what the conversation is grounded in,
            then the messages. The page itself does not scroll. */}
        <div className="chat-transcript" ref={transcript}>
          <StoryContext
            briefing={briefing}
            busy={busy}
            detached={detachedSession}
            onSelectStory={setSelectedStoryId}
            onStart={() => {
              void changeConversation(startConversation);
            }}
            selectedStory={selectedStory}
            selectedStoryId={selectedStoryId}
            session={session}
          />
          {session !== null && (
            <div aria-live="polite" className="chat-messages">
              {messages.length === 0 && (
                <p className="chat-empty">
                  Try “What changed?” or “What is the practical implication
                  here?”
                </p>
              )}
              {messages.map((message) => (
                <article
                  className={`chat-message chat-message-${message.role}`}
                  key={message.id}
                >
                  <strong>
                    {message.role === 'user' ? 'You' : 'Briefing Agent'}
                  </strong>
                  <p>{message.content}</p>
                </article>
              ))}
              {isRecovering && (
                <p className="chat-status">Reconnecting to your answer…</p>
              )}
            </div>
          )}
        </div>
        {session !== null && (
          <ChatComposer
            busy={busy}
            composer={composer}
            input={input}
            jumpToLatest={jumpToLatest}
            onInput={setInput}
            onSubmit={submit}
            questionRef={question}
            showJump={showJump}
          />
        )}
      </div>
      {drawerOpen && (
        <ConversationDrawer
          activeSessionId={session?.id ?? null}
          busy={busy}
          onClose={() => {
            setDrawerOpen(false);
          }}
          onDelete={() => {
            void changeConversation(removeConversation);
          }}
          onNew={() => {
            setDrawerOpen(false);
            void changeConversation(beginNewConversation);
          }}
          onOpen={(item) => {
            setDrawerOpen(false);
            void changeConversation(() => openConversation(item));
          }}
          sessions={sessions}
        />
      )}
    </section>
  );
}

/**
 * Shows what a follow-up is grounded in: the story picker before a conversation
 * exists, the active story once it does, and the stored citations for either.
 */
function StoryContext({
  briefing,
  busy,
  detached,
  onSelectStory,
  onStart,
  selectedStory,
  selectedStoryId,
  session,
}: {
  briefing: Briefing;
  busy: boolean;
  detached: boolean;
  onSelectStory: (storyId: string) => void;
  onStart: () => void;
  selectedStory: BriefingItem | undefined;
  selectedStoryId: string;
  session: ChatSession | null;
}) {
  return (
    <>
      {session === null ? (
        <div className="chat-start">
          <h2>Start a conversation</h2>
          <p className="chat-hint">
            Pick the story this conversation stays grounded in. Its stored
            sources are the only evidence a follow-up can cite.
          </p>
          <label className="chat-story-picker">
            Story context
            <select
              aria-label="Story context"
              disabled={busy}
              onChange={(event) => {
                onSelectStory(event.target.value);
              }}
              value={selectedStoryId}
            >
              {briefing.items.map((story) => (
                <option key={story.id} value={story.id}>
                  {story.headline}
                </option>
              ))}
            </select>
          </label>
          <button
            className="primary"
            disabled={busy || selectedStory === undefined}
            onClick={onStart}
            type="button"
          >
            Start saved conversation
          </button>
        </div>
      ) : (
        <div className="chat-active-story">
          <span>Story context</span>
          <strong>{session.storyHeadline}</strong>
          <small>
            {session.briefingDate}
            {detached ? ' · this briefing was deleted' : ''}
          </small>
        </div>
      )}
      {!detached && selectedStory !== undefined && (
        <ChatSources story={selectedStory} />
      )}
    </>
  );
}

/**
 * Question composer.
 *
 * The textarea starts at one line and grows with the question up to the bound in
 * CSS, so a long follow-up stays readable without taking the transcript's
 * screen. Jump to latest appears above it only while the reader is away from the
 * end of the transcript.
 */
function ChatComposer({
  busy,
  composer,
  input,
  jumpToLatest,
  onInput,
  onSubmit,
  questionRef,
  showJump,
}: {
  busy: boolean;
  composer: { disabled: boolean; placeholder: string };
  input: string;
  jumpToLatest: () => void;
  onInput: (value: string) => void;
  onSubmit: (event: React.SyntheticEvent<HTMLFormElement>) => void;
  questionRef: React.RefObject<HTMLTextAreaElement | null>;
  showJump: boolean;
}) {
  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    const action = composerKeyAction(event, {
      coarsePointer: usesTouchInput(),
    });

    if (action === 'submit') {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();

      return;
    }

    if (action !== 'newline') return;
    event.preventDefault();
    const inserted = insertLineBreak(
      event.currentTarget.value,
      event.currentTarget.selectionStart,
      event.currentTarget.selectionEnd,
    );

    onInput(inserted.value);
    requestAnimationFrame(() => {
      event.currentTarget.setSelectionRange(inserted.caret, inserted.caret);
    });
  }

  return (
    <form className="chat-composer" onSubmit={onSubmit}>
      {showJump && (
        <button className="chat-jump" onClick={jumpToLatest} type="button">
          Jump to latest
        </button>
      )}
      <label>
        <span className="sr-only">Your question</span>
        <textarea
          disabled={composer.disabled}
          maxLength={2_000}
          onChange={(event) => {
            onInput(event.target.value);
          }}
          onKeyDown={handleKeyDown}
          placeholder={composer.placeholder}
          ref={questionRef}
          rows={1}
          value={input}
        />
      </label>
      <p className="chat-hint chat-composer-hint">
        <span className="chat-hint-keys">
          Enter sends your question. ⌘Enter (or Ctrl+Enter) starts a new line.
        </span>
        <span className="chat-hint-touch">
          Return adds a line. Tap Ask question to send.
        </span>
      </p>
      <div>
        <button disabled={composer.disabled || !input.trim()} type="submit">
          {busy ? 'Answering…' : 'Ask question'}
        </button>
      </div>
    </form>
  );
}

/** True when the primary pointer is a touch screen, where Return must not send a question. */
function usesTouchInput(): boolean {
  return window.matchMedia('(pointer: coarse)').matches;
}

/** Keeps input disabled when a retained transcript no longer has briefing evidence. */
function chatComposerState(
  busy: boolean,
  detached: boolean,
): {
  disabled: boolean;
  placeholder: string;
} {
  if (detached)
    return {
      disabled: true,
      placeholder: 'This conversation’s source was deleted',
    };

  return {
    disabled: busy,
    placeholder: 'Ask a follow-up about the selected story',
  };
}

/** Identifies a transcript whose source edition has been permanently deleted. */
function isDetachedSession(session: ChatSession | null): boolean {
  return session?.briefingRunId === null;
}

/** Loads today's edition first, the newest saved edition, and retained conversations. */
async function loadChatData(): Promise<{
  edition: Briefing | null;
  sessions: ChatSession[];
}> {
  const [edition, sessions] = await Promise.all([
    loadChatBriefing(),
    listChatSessions(),
  ]);

  return { edition, sessions };
}

/** Refreshes the custom session transcript after Agent transport persists a turn. */
async function refreshSession(
  sessionId: string,
  setMessages: (messages: ChatMessage[]) => void,
): Promise<void> {
  try {
    const history = await readChatSession(sessionId);

    setMessages(history.messages);
  } catch {
    // The current view retains its last reliable transcript if a poll fails.
  }
}

/** Reads today's edition first, then the newest retained edition for useful next-day follow-ups. */
async function loadChatBriefing(): Promise<Briefing | null> {
  const today = await readTodayBriefing();

  if (today !== null) return today;

  const latest = (await listBriefingArchive())[0];

  return latest === undefined ? null : readArchivedBriefing(latest.runId);
}

/**
 * Renders only citations selected by application code for the current story context.
 *
 * The list starts collapsed so the transcript keeps the screen, while the
 * summary states the evidence tiers: a reader who never expands it still learns
 * that a story was answered from a limited source description.
 */
function ChatSources({ story }: { story: BriefingItem }) {
  return (
    <details className="chat-sources">
      <summary>
        Sources ({story.citations.length})
        <small>
          {evidenceSummary(
            story.citations.map((source) => source.evidenceTier),
          )}
        </small>
      </summary>
      <ul>
        {story.citations.map((source, index) => (
          <li key={source.sourceUrl}>
            <a href={source.sourceUrl} rel="noreferrer" target="_blank">
              [S{String(index + 1)}]{' '}
              {source.publisher ?? new URL(source.sourceUrl).hostname}
            </a>{' '}
            <span>
              {source.evidenceTier === 'article'
                ? 'article evidence'
                : 'limited source description'}
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}
