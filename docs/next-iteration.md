# Next iteration: integrate local SearXNG and preserve fallback metadata

This document records the completed integration and its historical plan.
The maintained milestone plan and next slice (3.5: model evaluation) are now
in [implementation-plan.md](implementation-plan.md).

Implemented on 2026-09-18 after authorization. Awaiting user review.

The local content lab now searches SearXNG through the Worker, preserves
attributed snippets and optional dates, and retrieves individual articles.
It shows evidence tiers, extraction text, source links, and partial failures.
No AI summaries or persistence were added.

Live checks returned ten candidates per initial topic. AI EWTN and world-news
WFAE articles were readable; AP returned 403 and qualified for description
fallback. Old and undated results remain visible with warnings. Last-day AI
search returned no candidates during a Bing connection failure; the inspector
defaults to Any time without silently widening selected filters. Paragraph
extraction included footer/related text. Resolve freshness and extraction
quality before trusting automated briefing output.
Liverpool's Sports Illustrated lead returned 403 through the UI and exposed
the attributed description fallback. This run demonstrated failure handling,
not successful article coverage for that topic; earlier standalone successes
do not guarantee availability in the Worker.

## Goal

Close the gap between the standalone local SearXNG experiment and the Worker:
return validated publisher leads, preserve informative snippets, and expose
the evidence tier for each candidate. This finishes discovery feasibility
before we build persisted topic management.

## Small steps

1. Extend shared discovery contracts with optional description/provenance,
   provider/query attribution, and date provenance. Keep original discovery
   URL distinct from resolved publisher URL. Preserve existing provider callers.
2. Add `discovery/searxng.ts` using the configured local base URL. Validate JSON
   results, cap request/time/bytes/results, and retain partial engine failures.
   Do not add remote hosting or a plugin registry.
3. Make evidence retrieval work with direct publisher URLs independently of
   provider identity. Stream Worker byte limits and contain body-read errors.
   Keep redirect validation and explicit retrieval failures.
4. Add description fallback qualification and an explicit evidence-tier result
   to feasibility diagnostics. Prefer article evidence, retain why retrieval
   failed, and reject repeated-headline descriptions. Do not compose AI
   briefings yet or claim a snippet is article text.
5. Add interface fixtures and verify through the local Worker for AI, world
   news, and Liverpool. Record freshness, extraction failures, and unknown
   dates alongside successes. Update backlog and prompt history; request review.

## Validation criteria

- `npm run check` passes and the local frontend/health route still work.
- Worker calls local SearXNG and returns validated direct source links.
- Fixtures distinguish article evidence, informative attributed descriptions,
  headline-only results, and unavailable evidence.
- Oversized/broken responses and partial engine failures have bounded outcomes.
- Description fallback cannot bypass exclusions, lose provenance, or invent
  dates. Unknown-date eligibility remains an explicit decision before publication.
- Live measurements record candidate count, checked article count, evidence
  availability, and freshness problems; no fixed number of stories is guaranteed.

## Following increments

The Bing-only warning described below is superseded by concrete local date
filtering: all three engines are queried, then returned dates are filtered
before result capping. Last day is 24 hours, month 31 days, year 365 days.
The live Last day UI returned three eligible AI leads with all three engines
represented, and displayed exact boundaries plus excluded/undated counts.

Follow-up diagnosis: installed DuckDuckGo News and Brave News do not support
time filters. SearXNG skips them when `time_range` is set, leaving Bing as the
only eligible engine. Matched Worker requests confirmed Last day = ten
Bing-only leads; Any time = ten mixed-engine leads. The UI now explicitly warns
about this change. Before briefing generation, evaluate searching all engines
without provider time filters and enforcing freshness from reliable publication
dates, with an explicit policy for undated leads. Never silently widen a filter.

**Topic management:** responsive app shell and persisted topic add/edit/pause/delete
using Agent-owned SQLite migrations. Global schedule/reading defaults remain
separate. Verify restart persistence, isolated topic edits, disabled-topic
behavior, and rejection of invalid input.

**Topic interpretation:** natural-language proposals scoped to one topic,
review/Apply, structured search concepts, and summary overrides. Verify that
rejected/stale proposals change nothing and global settings cannot be silently
changed by a topic prompt.

Manual briefing Workflows, grounded chat/memory, scheduling, and protected
deployment follow the original milestone sequence after these review gates.
