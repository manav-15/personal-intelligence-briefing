#!/usr/bin/env node

import { DatabaseSync } from 'node:sqlite';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

const defaultStateDirectory =
  '.wrangler/state/v3/do/personal-intelligence-briefing-PersonalBriefingAgent';

/** Opens the local singleton Agent database or an explicitly supplied database file. */
function openDatabase() {
  const path = process.env.BRIEFING_STATE_DB ?? findLocalStateDatabase();

  return new DatabaseSync(path, { readOnly: true });
}

/** Finds the single Durable Object SQLite state file created by local Wrangler. */
function findLocalStateDatabase() {
  const files = readdirSync(defaultStateDirectory).filter(
    (file) => file.endsWith('.sqlite') && file !== 'metadata.sqlite',
  );
  const file = files[0];

  if (file === undefined)
    throw new Error('No local PersonalBriefingAgent state database was found.');

  return join(defaultStateDirectory, file);
}

/** Returns a count object keyed by a bounded diagnostic value. */
function countBy(values, selector) {
  return Object.fromEntries(
    Object.entries(
      values.reduce((counts, value) => {
        const key = selector(value);

        counts[key] = (counts[key] ?? 0) + 1;

        return counts;
      }, {}),
    ).sort((left, right) => right[1] - left[1]),
  );
}

/** Builds a compact report without retaining snippets or publisher article text. */
function reportForRun(row, briefing) {
  const snapshot = JSON.parse(row.collection_snapshot);
  const diagnostics =
    row.collection_diagnostics === null
      ? null
      : JSON.parse(row.collection_diagnostics);
  const topics = Object.fromEntries(
    snapshot.preferences.topics.map((topic) => [topic.id, topic.name]),
  );
  const candidates = diagnostics?.candidates ?? [];

  return {
    run: {
      id: row.id,
      status: row.status,
      createdAt: row.created_at,
      publishedAt: row.published_at,
      failureMessage: row.failure_message,
    },
    topics: snapshot.preferences.topics
      .filter((topic) => topic.enabled)
      .map((topic) => topic.name),
    queries: (diagnostics?.queries ?? []).map((query) => ({
      topic: topics[query.topicId] ?? query.topicId,
      provider: query.provider,
      query: query.query,
      status: query.status,
      returned: query.returned,
      failures: query.failureCount,
    })),
    candidateOutcomes: countBy(candidates, (candidate) => candidate.outcome),
    engineOutcomes: engineOutcomes(candidates),
    recoveredDates: candidates
      .filter((candidate) => candidate.dateProvenance?.startsWith('publisher-'))
      .map((candidate) => ({
        title: candidate.title,
        engines: candidate.engines ?? [],
        outcome: candidate.outcome,
        publishedAt: candidate.publishedAt,
        provenance: candidate.dateProvenance,
      })),
    published: briefing === undefined ? null : publishedSummary(briefing),
  };
}

/** Groups retained candidate outcomes by every engine that contributed the result. */
function engineOutcomes(candidates) {
  const occurrences = candidates.flatMap((candidate) =>
    ((candidate.engines ?? []).length === 0
      ? ['unknown']
      : candidate.engines
    ).map((engine) => ({ engine, outcome: candidate.outcome })),
  );

  return Object.fromEntries(
    [...new Set(occurrences.map((occurrence) => occurrence.engine))]
      .sort()
      .map((engine) => [
        engine,
        countBy(
          occurrences.filter((occurrence) => occurrence.engine === engine),
          (occurrence) => occurrence.outcome,
        ),
      ]),
  );
}

/** Reduces a published briefing to inclusion and evidence-tier measurements. */
function publishedSummary(briefing) {
  return {
    completeness: briefing.completeness,
    itemCount: briefing.items.length,
    items: briefing.items.map((item) => ({
      headline: item.headline,
      topicIds: item.topicIds,
      evidenceTiers: item.citations.map((citation) => citation.evidenceTier),
    })),
  };
}

/** Reads a requested run ID or the newest local run and prints its quality report. */
function main() {
  const db = openDatabase();
  const requestedRunId = process.argv[2];
  const row =
    requestedRunId === undefined
      ? db
          .prepare(
            `SELECT * FROM briefing_runs ORDER BY datetime(created_at) DESC, rowid DESC LIMIT 1`,
          )
          .get()
      : db
          .prepare(`SELECT * FROM briefing_runs WHERE id = ?`)
          .get(requestedRunId);

  if (row === undefined) throw new Error('Briefing run was not found.');
  const briefingRow = db
    .prepare(`SELECT document FROM briefings WHERE run_id = ?`)
    .get(row.id);
  const briefing =
    briefingRow === undefined ? undefined : JSON.parse(briefingRow.document);

  console.log(JSON.stringify(reportForRun(row, briefing), null, 2));
}

main();
