# Implementation plan

Last updated: 2026-09-18. Maintain this plan after each increment or scope
decision. Record evidence, limitations, and review status; do not mark a whole
milestone complete when only a smaller slice is delivered.

## Original milestones

| Increment                                   | Deliverable                                                                                                   | Acceptance criteria                                                                                                                  | Status                                                         |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------- |
| **1. Git, stack, hygiene**                  | Initialize Git on `main`; scaffold minimal React/Worker application; configure tooling, documentation, and CI | Fresh install, local startup, and all baseline checks pass; you review stack and structure before features                           | Completed; foundation committed                                |
| **2. Discovery/evidence feasibility**       | Google News adapter, publisher-link resolution, bounded article extraction, fixtures for your three topics    | Demonstrate relevant results, usable article text, working links, and explicit failure outcomes from Workers; report actual coverage | Feasibility delivered with limitations; local inspection added |
| **3. App shell and persistent preferences** | Five responsive screens, singleton agent, SQLite migrations, editable preferences, propose/apply flow         | Preferences survive reload/restart; prompt-controlled summary style is preserved; rejected proposals change nothing                  | Next; not started                                              |
| **4. Manual briefing**                      | Generate-now Workflow, ranking, deduplication, citations, Today and Archive                                   | Produces a useful briefing across all three topics; exclusions and length hold; retries cannot duplicate publication                 | Planned                                                        |
| **5. Grounded chat and memory**             | Story follow-ups, persistent conversation history, prior-coverage comparison, deletion controls               | Answers cite available evidence; meaningful updates explain what changed; missing evidence is acknowledged                           | Planned                                                        |
| **6. Scheduled operation and deployment**   | Daily scheduling, Access protection, run status, retention cleanup, usage tracking, deployment instructions   | Scheduled/manual collisions, partial failures, timezone behavior, authentication, and mobile flows pass                              | Planned                                                        |

## Increment 2 outcome and retained limitations

Google News RSS and GDELT adapters, direct publisher retrieval, local SearXNG,
shared validated contracts, description fallback qualification, and the content
lab are implemented. Latest full quality gate passed 50 tests and production
build; frontend and Worker were verified locally.

Google RSS publisher-link decoding remains outside the Worker; SearXNG supplies
direct publisher leads instead. Recent GDELT calls returned 429. Live Worker
checks extracted EWTN/WFAE text; AP/Sports Illustrated returned 403 and used
labelled descriptions. Liverpool had earlier standalone extraction successes,
but the latest Worker sample did not establish successful article coverage.
These are measured examples, not a guaranteed coverage rate.

Keep application-side filtering for now. It runs in the Worker, not browser
JavaScript: query all three news engines, filter returned search-reported dates
against inclusive rolling UTC ranges, then cap results. Day = 24 hours,
month = 31 days, year = 365 days. Filtered searches exclude undated/future leads.

**TODO DISC-06:** evaluate provider-side time filtering with standalone scripts;
verify each source honors transmitted parameters before changing adapters.
Record supported/unsupported filters, test outgoing requests and returned dates,
and compare freshness/coverage with current filtering. Custom adapters or an
official API require a separate reviewed change. Current filtering can miss
recent articles absent from the engines' returned candidates.

Robust article extraction (footer contamination), verified publication dates,
unknown-date policy, and DNS-aware outbound restrictions remain in the
[pipeline backlog](data-pipeline.md). Address relevant blockers before automatic
briefing publication or production deployment, rather than expanding this
increment indefinitely.

## Increment 3: small reviewable slices

1. **3A — App shell and manual persistent topics.** Add Today, Chat, Topics,
   Archive, and Memory/Settings navigation. Keep the content lab reachable.
   Introduce one singleton Agent with Durable Object SQLite and versioned SQL
   migrations. Add validated topic add/edit/pause/delete and global schedule,
   reading budget, summary/source defaults. Topic overrides inherit global
   values. Unimplemented screens explicitly show their status.
2. **3B — Topic-scoped interpretation.** Use configurable Workers AI to propose
   structured topic changes, search concepts, and summary style. Show a
   before/after proposal; persist only after explicit Apply. Reject stale
   revisions and prevent topic requests from silently changing global settings.

Review 3A before starting 3B. Do not introduce briefing generation, scheduling,
or grounded chat during these slices.

### 3A validation

- Topics and global defaults survive browser reload and a local Worker restart.
- Adding/editing one topic preserves others; pause state persists and the
  enabled-topic read interface omits paused topics for future run snapshots.
- Summary wording/overrides survive round trips; invalid input changes nothing.
- SQLite migrations work on a fresh database and repeated startup.
- All five routes work on desktop/mobile; the content lab still works.
- `npm run check`, local API checks, and browser flows pass.

### 3B validation

- Deterministic interpretation fixtures preserve requested style/exclusions.
- Rejected, ambiguous, invalid, and stale proposals change nothing.
- Applied changes survive restart and affect only the selected scope.
- A separate bounded live model evaluation records interpretation quality and
  usage; CI does not depend on live inference.

## Update log

- **2026-09-18:** Consolidated original milestones and current feasibility
  evidence. Retained application-side date filtering by user decision; added
  DISC-06. Next implementation slice is 3A, followed by review and 3B.
