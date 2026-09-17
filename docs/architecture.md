# Architecture decisions

## Initial shape

One Worker serves the React assets and first-party routes. A single personal
Agent will later own persistent preferences, conversations, briefings, covered
stories, and run state in Durable Object SQLite. A Workflow will perform the
daily briefing pipeline.

## Evidence pipeline

The detailed reference, implementation status, fallback policy, and improvement
backlog live in [data-pipeline.md](data-pipeline.md).

The system will interpret a natural-language preference request into a proposed
structured preference change. After the user applies it, the Workflow will
snapshot preferences, discover stories, normalize and deduplicate them, rank
them, retrieve bounded evidence, summarize, validate citations, and publish
atomically.

Configuration is topic-first: users add and edit independent topics. Global
settings supply the schedule, total reading budget, and inherited defaults.
Implement persisted manual topic management before natural-language topic
proposals. One all-in-one briefing prompt is optional later convenience.

If stronger relevant article results are insufficient, the planned pipeline
may include informative attributed descriptions as labelled limited items.
Headline-only results cannot support expanded summaries. Fallback eligibility,
freshness, provenance, and proposed caps are specified in `data-pipeline.md`;
the fallback is not yet implemented.

Discovery will first use Google News RSS search. It is behind an adapter seam so
GDELT can supply a second channel with direct publisher links. Providers live in
separate files under `src/server/discovery`, with shared normalized contracts
and a small barrel entrypoint; there is no plugin registry. Article retrieval is a separate
module: discovery links alone are not evidence for claims.

GDELT uses one English-language article-list query over the past week, bounded
to 25 results, 750 KB, and a 10-second timeout. Rate limits are explicit
recoverable failures; this adapter does not retry. GDELT's indexing `seendate`
is not a publication timestamp, so publication time remains unknown. Publisher
names currently use the destination hostname. Source-quality ranking and
configurable language/lookback are deferred.

## Discovery feasibility result

Google News RSS returned candidates for the initial AI, world-news, and
Liverpool topics. Its encoded item links first redirect to another Google News
URL, then return a large Google HTML page rather than a publisher URL. The
current code reports this as unavailable evidence and does not summarize it as
an article. A dedicated Google-link decoder or a different discovery provider
must be evaluated and reviewed before the product enables article retrieval.

## Defaults

Initial interests are AI, major world/geopolitical news, Premier League, and
Liverpool FC. A daily five-minute briefing is due at 08:00 Asia/Kolkata. It
returns 8–10 strong stories, avoids padding weak sections, and only resurfaces
material updates with an explanation of what changed.

Partial failures publish an explicitly incomplete briefing. A complete failure
preserves the prior dated briefing. Briefings and conversations persist until
deleted; duplicate-detection data expires after 90 days.

## Cost controls

Workers AI model selection is configurable. Each run will cap queries,
retrievals, model input, output, and retries, and record usage. The target is
below USD 10–20/month for a single user. Email, push, broad web browsing, and
remote SearXNG hosting are deferred. Local SearXNG is available for feasibility
testing; its Worker provider is not yet implemented.
