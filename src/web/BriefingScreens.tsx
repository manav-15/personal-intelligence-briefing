import { useEffect, useState } from 'react';
import type { Briefing, BriefingArchiveEntry } from '../shared/briefings';
import { listBriefingArchive, readLatestBriefing } from './briefings-client';

/** Reads and renders the newest published briefing without starting a run. */
export function TodayScreen() {
  const [briefing, setBriefing] = useState<Briefing | null | undefined>();

  useEffect(() => {
    void readLatestBriefing()
      .then(setBriefing)
      .catch(() => {
        setBriefing(null);
      });
  }, []);

  if (briefing === undefined) return <BriefingLoading title="Today" />;

  if (briefing === null)
    return (
      <BriefingEmpty
        title="Today"
        message="No briefing has been published yet. Manual generation arrives in the next slice."
      />
    );

  return <BriefingView briefing={briefing} />;
}

/** Reads and renders briefing publication metadata without loading full stories. */
export function ArchiveScreen() {
  const [briefings, setBriefings] = useState<
    BriefingArchiveEntry[] | undefined
  >();

  useEffect(() => {
    void listBriefingArchive()
      .then(setBriefings)
      .catch(() => {
        setBriefings([]);
      });
  }, []);

  if (briefings === undefined) return <BriefingLoading title="Archive" />;

  if (briefings.length === 0)
    return (
      <BriefingEmpty
        title="Archive"
        message="Published briefings will appear here after manual generation is implemented."
      />
    );

  return (
    <section className="briefing-screen">
      <p className="eyebrow">PUBLISHED BRIEFINGS</p>
      <h1>Archive</h1>
      <ul className="briefing-archive">
        {briefings.map((briefing) => (
          <li key={briefing.runId}>
            <strong>{briefing.date}</strong>
            <span>{`${String(briefing.itemCount)} stories · ${briefing.completeness}`}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function BriefingView({ briefing }: { briefing: Briefing }) {
  return (
    <section className="briefing-screen">
      <p className="eyebrow">{briefing.completeness.toUpperCase()}</p>
      <h1>Today</h1>
      <p className="intro">Published for {briefing.date}</p>
      {briefing.limitations.length > 0 ? (
        <aside className="briefing-limitations">
          <strong>Collection limits</strong>
          <ul>
            {briefing.limitations.map((limitation) => (
              <li key={limitation.code}>{limitation.message}</li>
            ))}
          </ul>
        </aside>
      ) : null}
      <div className="briefing-items">
        {briefing.items.map((item) => (
          <article key={item.id} className="briefing-item">
            <p className="eyebrow">{item.topicIds.join(' · ')}</p>
            <h2>{item.headline}</h2>
            <p>{item.summary}</p>
            <ul aria-label="Sources">
              {item.citations.map((citation) => (
                <li key={citation.sourceUrl}>
                  <a href={citation.sourceUrl} rel="noreferrer" target="_blank">
                    {citation.publisher ?? citation.sourceUrl}
                  </a>{' '}
                  <span>{citation.evidenceTier}</span>
                </li>
              ))}
            </ul>
          </article>
        ))}
      </div>
    </section>
  );
}

function BriefingEmpty({ title, message }: { title: string; message: string }) {
  return (
    <section className="planned-screen">
      <p className="eyebrow">NO PUBLISHED BRIEFING</p>
      <h1>{title}</h1>
      <p className="intro">{message}</p>
    </section>
  );
}

function BriefingLoading({ title }: { title: string }) {
  return (
    <section className="planned-screen">
      <p className="eyebrow">LOADING</p>
      <h1>{title}</h1>
    </section>
  );
}
