import { useEffect, useState } from 'react';
import { Link, useParams, useLocation } from 'react-router';
import type {
  Briefing,
  BriefingArchiveEntry,
  BriefingItem,
  BriefingRunStatusResponse,
} from '../shared/briefings';
import { listBriefingArchive, readArchivedBriefing } from './briefings-client';
import { useBriefing } from './useBriefing';

/** Displays today's edition and restores durable generation progress. */
export function TodayScreen() {
  const state = useBriefing();

  if (state.loading) return <BriefingLoading title="Your daily briefing" />;

  return (
    <div className="today-screen">
      <div className="briefing-controls">
        <Link to="/topics">Manage topics</Link>
        <button
          disabled={!state.canGenerate}
          onClick={() => void state.generate()}
        >
          {state.busy
            ? 'Preparing your briefing…'
            : state.briefing === null
              ? 'Generate briefing'
              : 'Refresh briefing'}
        </button>
      </div>
      {state.error !== null && (
        <div className="briefing-feedback" role="alert">
          <p>{state.error}</p>
          <button onClick={state.reload}>Try loading again</button>
        </div>
      )}
      {state.run !== null && <RunStatus run={state.run} />}
      {state.briefing !== null ? (
        <BriefingView briefing={state.briefing} />
      ) : (
        state.error === null && (
          <section className="briefing-screen briefing-empty">
            <p className="eyebrow">A little perspective for your day</p>
            <h1>Your daily briefing</h1>
            <p className="intro">
              {state.busy
                ? 'We’re finding recent stories and checking the sources. You can leave this page and come back.'
                : 'Your next edition starts here. Generate a concise, cited briefing from your saved topics.'}
            </p>
            <Link
              to={
                state.latest === null
                  ? '/archive'
                  : `/archive/${state.latest.runId}`
              }
            >
              {state.latest === null
                ? 'Read a previous edition →'
                : `Read the latest edition — ${friendlyDate(state.latest.date)} →`}
            </Link>
          </section>
        )
      )}
    </div>
  );
}

function RunStatus({ run }: { run: BriefingRunStatusResponse }) {
  if (run.status === 'published') return null;

  if (run.status === 'running')
    return (
      <p className="briefing-progress" role="status">
        <span aria-hidden="true" className="progress-dot" /> Gathering and
        preparing your stories. This can take a few minutes.
      </p>
    );

  return (
    <aside className="briefing-feedback" role="status">
      <strong>We couldn’t finish this edition</strong>
      <p>
        {run.failureMessage ?? 'Please try generating again.'} Previous editions
        are safe.
      </p>
      {run.collectionFailures.length > 0 && (
        <details>
          <summary>Collection details</summary>
          <ul>
            {run.collectionFailures.map((failure, index) => (
              <li key={index}>
                {failure.provider === null ? '' : `${failure.provider}: `}
                {failure.message}
              </li>
            ))}
          </ul>
        </details>
      )}
    </aside>
  );
}

/** Lists dated editions with links to their complete retained content. */
export function ArchiveScreen() {
  const [briefings, setBriefings] = useState<BriefingArchiveEntry[] | null>(
    null,
  );
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;

    void listBriefingArchive()
      .then((entries) => {
        if (!cancelled) {
          setBriefings(entries);
          setError(false);
        }
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });

    return () => {
      cancelled = true;
    };
  }, [attempt]);

  if (error)
    return (
      <LoadError
        retry={() => {
          setAttempt((value) => value + 1);
        }}
      />
    );

  if (briefings === null) return <BriefingLoading title="Previous editions" />;

  return (
    <section className="briefing-screen">
      <p className="eyebrow">Your reading library</p>
      <h1>Previous editions</h1>
      <p className="intro">Return to the stories and sources that mattered.</p>
      {briefings.length === 0 ? (
        <p>
          No editions yet. <Link to="/">Create your first briefing →</Link>
        </p>
      ) : (
        <ul className="briefing-archive">
          {briefings.map((entry) => (
            <li key={entry.runId}>
              <Link to={`/archive/${entry.runId}`}>
                <strong>{friendlyDate(entry.date)}</strong>
                <span>
                  {entry.itemCount}{' '}
                  {entry.itemCount === 1 ? 'story' : 'stories'} ·{' '}
                  {entry.completeness === 'partial'
                    ? 'Limited coverage'
                    : 'Full edition'}{' '}
                  ·{' '}
                  {new Date(entry.publishedAt).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
              </Link>
              <span aria-hidden="true">→</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Opens an immutable archived edition without relabeling it as today. */
export function ArchivedBriefingScreen() {
  const { runId } = useParams();
  const { hash } = useLocation();
  const [briefing, setBriefing] = useState<Briefing | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;

    void readArchivedBriefing(runId ?? '')
      .then((edition) => {
        if (!cancelled) {
          setBriefing(edition);
          setError(edition === null);
        }
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });

    return () => {
      cancelled = true;
    };
  }, [runId, attempt]);

  useEffect(() => {
    if (briefing?.runId === runId && hash.startsWith('#story-'))
      document.getElementById(hash.slice(1))?.scrollIntoView();
  }, [briefing, runId, hash]);

  if (error)
    return (
      <LoadError
        retry={() => {
          setAttempt((value) => value + 1);
        }}
      />
    );

  if (briefing === null || briefing.runId !== runId)
    return <BriefingLoading title="Opening your edition" />;

  return (
    <>
      <p>
        <Link to="/archive">← All editions</Link>
      </p>
      <BriefingView briefing={briefing} />
    </>
  );
}

function BriefingView({ briefing }: { briefing: Briefing }) {
  const topics = [...new Set(briefing.items.flatMap((item) => item.topicIds))];
  const topicName = (id: string) =>
    briefing.topicNames?.[id] ??
    (id === 'ai' ? 'AI' : undefined) ??
    id.replaceAll('-', ' ').replace(/\b\w/gu, (letter) => letter.toUpperCase());
  const words = briefing.items.reduce(
    (total, item) =>
      total +
      `${item.headline} ${item.summary} ${item.update?.whatChanged ?? ''}`
        .trim()
        .split(/\s+/u).length,
    0,
  );

  return (
    <section className="briefing-screen">
      <p className="eyebrow">Your personal briefing</p>
      <h1>{friendlyDate(briefing.date)}</h1>
      <p className="edition-meta">
        {briefing.items.length}{' '}
        {briefing.items.length === 1 ? 'story' : 'stories'}{' '}
        <span aria-hidden="true">·</span> {Math.max(1, Math.ceil(words / 200))}{' '}
        min read
      </p>
      {briefing.completeness === 'partial' && (
        <aside className="coverage-note">
          <strong>Limited coverage</strong>
          <p>
            This edition includes the stories we could support. Some sources or
            topics may be missing.
          </p>
          {briefing.limitations.length > 0 && (
            <details>
              <summary>About this edition</summary>
              <ul>
                {[
                  ...new Set(briefing.limitations.map((item) => item.message)),
                ].map((message) => (
                  <li key={message}>{message}</li>
                ))}
              </ul>
            </details>
          )}
        </aside>
      )}
      <nav className="topic-jumps" aria-label="Topics in this edition">
        {topics.map((id) => (
          <a
            key={id}
            href={`#story-${briefing.items.find((item) => item.topicIds.includes(id))?.id ?? ''}`}
          >
            {topicName(id)}
          </a>
        ))}
      </nav>
      <div className="briefing-items">
        {briefing.items.map((item, index) => (
          <Story
            key={item.id}
            item={item}
            index={index}
            topicName={topicName}
          />
        ))}
      </div>
      <p className="edition-end">
        You’re all caught up with this edition.{' '}
        <Link to="/archive">Browse previous briefings →</Link>
      </p>
    </section>
  );
}

function Story({
  item,
  index,
  topicName,
}: {
  item: BriefingItem;
  index: number;
  topicName: (id: string) => string;
}) {
  return (
    <article id={`story-${item.id}`} className="briefing-item">
      <p className="eyebrow">
        <span className="story-number">
          {String(index + 1).padStart(2, '0')}
        </span>{' '}
        {item.topicIds.map(topicName).join(' · ')}
      </p>
      <h2>{item.headline}</h2>
      {item.summary
        .split(/\n+/u)
        .filter(Boolean)
        .map((paragraph, position) => (
          <p className="story-summary" key={position}>
            {paragraph}
          </p>
        ))}
      {item.update !== undefined && (
        <aside className="story-update">
          <strong>What changed</strong>
          <p>{item.update.whatChanged}</p>
          <div>
            {item.update.previousItems.map((previous) => (
              <Link
                key={`${previous.runId}-${previous.itemId}`}
                to={`/archive/${previous.runId}#story-${previous.itemId}`}
              >
                Earlier coverage →
              </Link>
            ))}
          </div>
        </aside>
      )}
      <ul className="story-sources" aria-label="Sources">
        {item.citations.map((citation) => (
          <li key={citation.sourceUrl}>
            <a href={citation.sourceUrl} rel="noreferrer" target="_blank">
              {citation.publisher ?? new URL(citation.sourceUrl).hostname}
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
            <span>
              {citation.evidenceTier === 'article'
                ? 'Article'
                : 'Limited source description'}
            </span>
          </li>
        ))}
      </ul>
    </article>
  );
}

function friendlyDate(date: string) {
  return new Intl.DateTimeFormat('en', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${date}T12:00:00Z`));
}

function LoadError({ retry }: { retry: () => void }) {
  return (
    <section className="briefing-screen" role="alert">
      <h1>Couldn’t load this briefing</h1>
      <p>Please check your connection and try again.</p>
      <button onClick={retry}>Try again</button>
    </section>
  );
}

function BriefingLoading({ title }: { title: string }) {
  return (
    <section className="briefing-screen" aria-busy="true">
      <p className="eyebrow" role="status">
        Loading your briefing…
      </p>
      <h1>{title}</h1>
      <div className="reading-skeleton" aria-hidden="true" />
    </section>
  );
}
