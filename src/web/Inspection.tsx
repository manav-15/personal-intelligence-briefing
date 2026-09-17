import { useEffect, useRef, useState, type SyntheticEvent } from 'react';
import {
  inspectionEvidenceResponseSchema,
  inspectionSearchResponseSchema,
  type InspectionEvidenceResult,
  type InspectionSearchResult,
  type StoryCandidate,
} from '../shared/inspection';

const examples = [
  { name: 'Artificial intelligence', query: 'artificial intelligence' },
  { name: 'World news', query: 'world geopolitics' },
  { name: 'Liverpool FC', query: 'Liverpool FC Premier League' },
];

/** Local search and evidence workbench; it does not generate summaries or save preferences. */
export function Inspection() {
  const [query, setQuery] = useState('artificial intelligence');
  const [timeRange, setTimeRange] = useState('any');
  const [limit, setLimit] = useState(10);
  const [result, setResult] = useState<InspectionSearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);

  useEffect(
    () => () => {
      controller.current?.abort();
    },
    [],
  );

  async function search(value: string) {
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const params = new URLSearchParams({
        q: value,
        limit: String(limit),
        timeRange,
      });
      const response = await fetch(`/api/inspection/search?${params}`, {
        signal: current.signal,
      });
      if (!response.ok)
        throw new Error(
          response.status === 404
            ? 'Local inspection is disabled. Copy .dev.vars.example to .dev.vars and restart the app.'
            : `Search failed (HTTP ${String(response.status)}). Check your query and local service.`,
        );
      const parsed = inspectionSearchResponseSchema.parse(
        await response.json(),
      );
      if (!current.signal.aborted) setResult(parsed);
    } catch (cause) {
      if (!current.signal.aborted)
        setError(
          cause instanceof Error
            ? cause.message
            : 'Search could not be completed.',
        );
    } finally {
      if (!current.signal.aborted) setLoading(false);
    }
  }

  function submit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    void search(query);
  }

  return (
    <>
      <section className="inspector-intro" aria-labelledby="inspection-title">
        <p className="eyebrow">LOCAL CONTENT LAB</p>
        <h1 id="inspection-title">A closer look at your sources.</h1>
        <p className="intro">
          Search a topic, open the original story, and inspect the text we can
          retrieve. No AI summaries or saved data yet.
        </p>
      </section>
      <section className="search-panel" aria-label="Search topics">
        <form onSubmit={submit}>
          <label className="query-field" htmlFor="query">
            Topic or search query
            <input
              id="query"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
              }}
              minLength={2}
              maxLength={200}
              required
              placeholder="e.g. AI model releases"
            />
          </label>
          <label htmlFor="time-range">
            Time range
            <select
              id="time-range"
              value={timeRange}
              onChange={(event) => {
                setTimeRange(event.target.value);
              }}
            >
              <option value="day">Last day</option>
              <option value="month">Last month</option>
              <option value="year">Last year</option>
              <option value="any">Any time</option>
            </select>
          </label>
          <label htmlFor="result-limit">
            Results
            <select
              id="result-limit"
              value={limit}
              onChange={(event) => {
                setLimit(Number(event.target.value));
              }}
            >
              <option value={5}>5</option>
              <option value={10}>10</option>
              <option value={15}>15</option>
            </select>
          </label>
          <button className="primary" type="submit" disabled={loading}>
            {loading ? 'Searching…' : 'Search'}
          </button>
        </form>
        <div className="topic-shortcuts" aria-label="Example topics">
          <span>Try a topic</span>
          {examples.map((example) => (
            <button
              key={example.name}
              disabled={loading}
              onClick={() => {
                setQuery(example.query);
                void search(example.query);
              }}
            >
              {example.name}
            </button>
          ))}
        </div>
        <p className="hint">
          Searches use Bing News, DuckDuckGo News, and Brave News. Last day
          means the previous 24 hours, month 31 days, and year 365 days. We
          filter search-reported dates; undated and future-dated leads are
          excluded.
        </p>
        {timeRange !== 'any' && (
          <p className="feedback warning" role="status">
            All three engines are searched. Date filtering applies to returned
            candidates; it cannot recover articles absent from those candidates.
            Search-reported dates may differ from publication dates.
          </p>
        )}
      </section>
      <div aria-live="polite">
        {loading && (
          <p className="feedback">Asking the configured news engines…</p>
        )}
        {error && (
          <p className="feedback error" role="alert">
            {error}
          </p>
        )}
        {result && (
          <section className="results" aria-label="Search results">
            <div className="results-heading">
              <h2>
                {result.stories.length} results for “{result.query}”
              </h2>
              <span className="hint">
                Observed {new Date(result.observedAt).toLocaleTimeString()}
              </span>
            </div>
            {result.dateFilter && (
              <p className="hint">
                Date range: {new Date(result.dateFilter.from).toLocaleString()}{' '}
                – {new Date(result.dateFilter.to).toLocaleString()}. Excluded{' '}
                {result.dateFilter.excluded} leads, including{' '}
                {result.dateFilter.undated} undated leads.
              </p>
            )}
            {result.failures.length > 0 && (
              <div className="feedback warning">
                <strong>Search limitations</strong>
                <ul>
                  {result.failures.map((failure, index) => (
                    <li key={`${failure.code}-${String(index)}`}>
                      {failure.message}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {result.stories.length === 0 && (
              <p className="feedback">
                {result.timeRange !== 'any'
                  ? 'No returned candidates have a reported date in this range. Try a wider range or Any time to inspect undated leads.'
                  : 'No usable results. Try a broader query.'}{' '}
                If the local service is unavailable, start SearXNG with{' '}
                <code>npm run searxng:start</code>.
              </p>
            )}
            <div className="story-grid">
              {result.stories.map((story) => (
                <StoryCard
                  key={`${result.observedAt}-${story.id}`}
                  story={story}
                  observedAt={result.observedAt}
                />
              ))}
            </div>
          </section>
        )}
        {!result && !loading && !error && (
          <div className="empty-state">
            <h2>Start with a topic you care about.</h2>
            <p>
              Results will include source descriptions and dates. Retrieve an
              article when you want to examine its evidence.
            </p>
          </div>
        )}
      </div>
    </>
  );
}

function StoryCard({
  story,
  observedAt,
}: {
  story: StoryCandidate;
  observedAt: string;
}) {
  const [inspection, setInspection] = useState<InspectionEvidenceResult | null>(
    null,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      controller.current?.abort();
    },
    [],
  );

  async function retrieve() {
    const current = new AbortController();
    controller.current?.abort();
    controller.current = current;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/inspection/evidence', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(story),
        signal: current.signal,
      });
      if (!response.ok)
        throw new Error(
          `Article inspection failed (HTTP ${String(response.status)}).`,
        );
      const data = inspectionEvidenceResponseSchema.parse(
        await response.json(),
      );
      if (!current.signal.aborted) setInspection(data);
    } catch (cause) {
      if (!current.signal.aborted)
        setError(
          cause instanceof Error ? cause.message : 'Article inspection failed.',
        );
    } finally {
      if (!current.signal.aborted) setLoading(false);
    }
  }

  const date = story.publishedAt === null ? null : new Date(story.publishedAt);
  const age = date === null ? null : Date.parse(observedAt) - date.getTime();
  const evidence = inspection?.evidence;
  return (
    <article className="story-card">
      <div className="story-meta">
        <span>{story.publisher ?? 'Unknown publisher'}</span>
        <span className="badge">{story.discovery}</span>
      </div>
      <h3>
        <a href={story.sourceUrl} target="_blank" rel="noopener noreferrer">
          {story.title}
        </a>
      </h3>
      <p className="date-line">
        {date ? (
          <>
            <time dateTime={story.publishedAt ?? undefined}>
              {date.toLocaleString()}
            </time>{' '}
            · date reported by search
          </>
        ) : (
          'Publication date unknown'
        )}
        {age !== null && age > 48 * 60 * 60 * 1000 && (
          <span className="date-warning">Older than 48 hours</span>
        )}
        {age !== null && age < -24 * 60 * 60 * 1000 && (
          <span className="date-warning">Future date — verify</span>
        )}
      </p>
      <p className="hint">
        Engines: {story.engines?.join(', ') || 'Not reported'}
      </p>
      {story.description ? (
        <div className="description">
          <span className="eyebrow">Search description</span>
          <p>{story.description.text}</p>
          <span className="hint">
            Search metadata, not retrieved article text.
          </span>
        </div>
      ) : (
        <p className="hint">Headline only: no description was supplied.</p>
      )}
      <div className="story-actions">
        <a href={story.sourceUrl} target="_blank" rel="noopener noreferrer">
          Open source ↗
        </a>
        <button
          disabled={loading}
          onClick={() => {
            void retrieve();
          }}
          aria-label={`Retrieve article: ${story.title}`}
        >
          {loading
            ? 'Retrieving…'
            : inspection
              ? 'Retrieve again'
              : 'Retrieve article'}
        </button>
      </div>
      {error && (
        <p className="feedback error" role="alert">
          {error}
        </p>
      )}
      {inspection && (
        <div className="evidence-panel">
          <p className="tier">
            <span className="badge">
              {inspection.tier === 'article'
                ? 'Article text'
                : inspection.tier === 'description'
                  ? 'Description only'
                  : 'Headline only'}
            </span>
          </p>
          {evidence?.status === 'usable' ? (
            <>
              <p className="hint">
                {evidence.text.length.toLocaleString()} characters ·{' '}
                {evidence.extraction === 'article-region'
                  ? 'Article region'
                  : 'Paragraph extraction'}{' '}
                · manually review quality
              </p>
              {evidence.pageTitle && (
                <p className="hint">Page title: {evidence.pageTitle}</p>
              )}
              <a
                href={evidence.articleUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="final-link"
              >
                Open final article URL ↗
              </a>
              {evidence.truncated && (
                <p className="feedback warning">
                  Text truncated to 12,000 characters.
                </p>
              )}
              <details open>
                <summary>Extracted article text</summary>
                <pre className="article-text">{evidence.text}</pre>
              </details>
            </>
          ) : (
            <>
              <p className="retrieval-failure">
                Article unavailable:{' '}
                {evidence?.status === 'unavailable'
                  ? evidence.reason
                  : 'No evidence.'}
              </p>
              {inspection.fallbackDescription ? (
                <p>
                  Only the attributed search description is available. It can
                  support a concise, limited item; it cannot support deeper
                  analysis.
                </p>
              ) : (
                <p>
                  No informative description qualifies for fallback. This result
                  is a source link only.
                </p>
              )}
            </>
          )}
        </div>
      )}
    </article>
  );
}
