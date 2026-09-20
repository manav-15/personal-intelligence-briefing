import { useAgent } from 'agents/react';
import { useAgentChat } from '@cloudflare/ai-chat/react';
import { useEffect, useState } from 'react';
import type { ChatMessage, ChatSession } from '../shared/chat';
import type { Briefing, BriefingItem } from '../shared/briefings';
import { composerKeyAction, insertLineBreak } from './chat-composer';
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

/** Renders source-grounded conversations that remain available after a browser reload. */
export function ChatScreen() {
  const [briefing, setBriefing] = useState<Briefing | null | undefined>(
    undefined,
  );
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [session, setSession] = useState<ChatSession | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loadFailed, setLoadFailed] = useState(false);
  const [selectedStoryId, setSelectedStoryId] = useState('');
  const [input, setInput] = useState('');
  const agent = useAgent({ agent: 'personal-briefing', name: 'single-user' });
  const {
    isRecovering,
    isStreaming,
    messages: transportMessages,
    sendMessage,
  } = useAgentChat({ agent, body: () => ({ sessionId: session?.id }) });
  const selectedStory = briefing?.items.find(
    (story) => story.id === selectedStoryId,
  );
  const busy = isStreaming || isRecovering;

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

  useEffect(() => {
    if (session === null || transportMessages.length === 0) return;

    void refreshSession(session.id, setMessages);
  }, [session, transportMessages.length]);

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

    await deleteChatSession(session.id);
    setSessions((current) => current.filter((item) => item.id !== session.id));
    setSession(null);
    setMessages([]);
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

    void sendMessage({
      role: 'user',
      parts: [{ type: 'text', text: question }],
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
      <p className="eyebrow">Grounded follow-ups</p>
      <h1>Ask about a story</h1>
      <p className="intro">
        Each conversation is saved under its selected story. Older briefing
        editions remain here as conversation history until you delete them.
      </p>
      <div className="chat-layout">
        <aside className="chat-library">
          <strong>Saved conversations</strong>
          <button
            onClick={() => {
              void beginNewConversation();
            }}
            type="button"
          >
            New conversation
          </button>
          {sessions.length === 0 && <p>No saved conversations yet.</p>}
          <ul>
            {sessions.map((item) => (
              <li key={item.id}>
                <button
                  aria-pressed={item.id === session?.id}
                  onClick={() => {
                    void openConversation(item);
                  }}
                  type="button"
                >
                  <span>{item.storyHeadline}</span>
                  <small>{item.briefingDate}</small>
                </button>
              </li>
            ))}
          </ul>
        </aside>
        <div className="chat-conversation">
          <label className="chat-story-picker">
            Story context
            <select
              aria-label="Story context"
              disabled={busy || session !== null}
              onChange={(event) => {
                setSelectedStoryId(event.target.value);
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
          {selectedStory !== undefined && <ChatSources story={selectedStory} />}
          {session === null ? (
            <button
              disabled={busy || selectedStory === undefined}
              onClick={() => {
                void startConversation();
              }}
              type="button"
            >
              Start saved conversation
            </button>
          ) : (
            <>
              <div aria-live="polite" className="chat-transcript">
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
              <form className="chat-composer" onSubmit={submit}>
                <label>
                  Your question
                  <textarea
                    disabled={busy}
                    maxLength={2_000}
                    onChange={(event) => {
                      setInput(event.target.value);
                    }}
                    onKeyDown={(event) => {
                      const action = composerKeyAction(event);

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

                      setInput(inserted.value);
                      requestAnimationFrame(() => {
                        event.currentTarget.setSelectionRange(
                          inserted.caret,
                          inserted.caret,
                        );
                      });
                    }}
                    placeholder="Ask a follow-up about the selected story"
                    value={input}
                  />
                </label>
                <p className="chat-empty">
                  Enter sends your question. ⌘Enter (or Ctrl+Enter) starts a new
                  line.
                </p>
                <div>
                  <button disabled={busy || !input.trim()} type="submit">
                    {busy ? 'Answering…' : 'Ask question'}
                  </button>
                  <button
                    disabled={busy}
                    onClick={() => {
                      void removeConversation();
                    }}
                    type="button"
                  >
                    Delete conversation
                  </button>
                </div>
              </form>
            </>
          )}
        </div>
      </div>
    </section>
  );
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

/** Renders only citations selected by application code for the current story context. */
function ChatSources({ story }: { story: BriefingItem }) {
  return (
    <aside className="chat-sources">
      <strong>Sources available to chat</strong>
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
    </aside>
  );
}
