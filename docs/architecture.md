# Architecture decisions

## Initial shape

One Worker serves the React assets and first-party routes. A single personal
Agent will later own persistent preferences, conversations, briefings, covered
stories, and run state in Durable Object SQLite. A Workflow will perform the
daily briefing pipeline.

## Evidence pipeline

The system will interpret a natural-language preference request into a proposed
structured preference change. After the user applies it, the Workflow will
snapshot preferences, discover stories, normalize and deduplicate them, rank
them, retrieve bounded evidence, summarize, validate citations, and publish
atomically.

Discovery will first use Google News RSS search. It is behind an adapter seam so
an owned SearXNG deployment can be added later. Article retrieval is a separate
module: discovery links alone are not evidence for claims.

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
SearXNG hosting are deferred.
