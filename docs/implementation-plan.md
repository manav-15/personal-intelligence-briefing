# Implementation plan

Last updated: 2026-09-18. Maintain this plan after each increment or scope
decision. Record evidence, limitations, and review status; do not mark a whole
milestone complete when only a smaller slice is delivered.

## Original milestones

| Increment                                   | Deliverable                                                                                                   | Acceptance criteria                                                                                                                  | Status                                                         |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------- |
| **1. Git, stack, hygiene**                  | Initialize Git on `main`; scaffold minimal React/Worker application; configure tooling, documentation, and CI | Fresh install, local startup, and all baseline checks pass; you review stack and structure before features                           | Completed; foundation committed                                |
| **2. Discovery/evidence feasibility**       | Google News adapter, publisher-link resolution, bounded article extraction, fixtures for your three topics    | Demonstrate relevant results, usable article text, working links, and explicit failure outcomes from Workers; report actual coverage | Feasibility delivered with limitations; local inspection added |
| **3. App shell and persistent preferences** | Five responsive screens, singleton agent, SQLite migrations, editable preferences, propose/apply flow         | Preferences survive reload/restart; prompt-controlled summary style is preserved; rejected proposals change nothing                  | 3.1–3.4 accepted; 3.5–3.6 planned                              |
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

### 3.1–3.2 completed

Added strict shared schemas for global and topic preferences, source/summary
inheritance, provider-neutral search concepts, and future topic proposals. The
contract module resolves effective values while preserving global exclusions and
blocked sources. It intentionally does not persist data or call a model.

Added responsive routes for Today, Chat, Topics, Archive, Memory & settings,
and Content lab. Only the content lab is functional; every other screen makes
its deferred state explicit. Direct routing, navigation, and active-page state
are implemented. Persistence remains 3.3 and manual management 3.4.

See [preference contracts](preferences-contracts.md) for inheritance, proposal,
future model evaluation, and relevance decisions.

### 3.3 — Persistence foundation: completed, awaiting review

Introduce one singleton Agent backed by Durable Object SQLite and explicit,
versioned SQL migrations. Implement a small preference module interface:
`readPreferences()` returns the current validated document or first-run state;
`replacePreferences(document, expectedRevision)` validates, compares revision,
writes atomically, and returns the advanced document. Do not add topic forms,
proposal application, model calls, briefing generation, schedules, or chat.

The browser gets a read-only route/API diagnostic only if needed to verify the
actual persisted document. The Topics and Settings screens remain deferred
until 3.4. Keep SQL and migration details behind the preference module seam;
tests use its interface rather than duplicating queries.

### 3.3 validation

- A fresh Durable Object creates the versioned schema and returns first-run
  state without inventing saved preferences.
- A valid replacement survives a new Agent instance / Durable Object restart.
- Invalid documents and revision conflicts leave the stored document unchanged.
- Migration is idempotent and upgrades the known empty database exactly once.
- Browser/API verification confirms the local Worker reaches the singleton
  Agent; the content lab and all routes remain available.
- `npm run check` and deterministic Worker integration tests pass.

### 3.4 — Manual topic management: completed and accepted

Topics and Memory & settings now read and revision-replace the local persisted
document. Topics can add, edit, pause, resume, and delete independent topics,
including user wording, exclusions, and summary/source overrides. Settings
edits global schedule, reading budget, summary defaults, sources, and
exclusions. Each browser update builds a complete document and validates it
before the Worker/Agent repeat their own validation. Revision conflicts reload
the saved document without applying stale changes.

Validation covers client request/response contracts, persisted add/edit/pause,
global settings, reload, and local Worker restart. The test topic and changed
test setting were removed after verification. This still uses the local-only
diagnostic endpoint; Access-backed production settings remains Increment 6.

### After 3.4

**HTTP refactor — completed and accepted:** replaced manual dispatch with pinned Hono,
group HTTP handlers under `src/server/routes/`, and preserve route-specific
diagnostic/origin/method/cache policies and bounded evidence reads. Add explicit
HEAD/OPTIONS and JSON 404 coverage, malformed-body checks, and guard-order tests.
This is a separate reviewable infrastructure slice before 3.4; domain behavior
and product scope remain unchanged. Validation results are recorded below.

**3.5** evaluates interpretation
models against fixed fixtures. **3.6** adds topic-scoped proposal/Apply.

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
- **2026-09-18:** Completed 3.1–3.2: validated shared preference/proposal
  contracts, decision record, responsive shell, direct routes, active navigation,
  and preserved content lab. `npm run check` passed with 53 tests; local Topics
  and Content lab routes were verified. Next is 3.3 persistence foundation.
- **2026-09-18:** Completed 3.3: installed pinned `agents` SDK, configured a
  SQLite Durable Object export/binding, and added singleton read/replace Agent
  operations with migration and revision results. Local verification wrote a
  document, rejected a stale update with HTTP 409, and retained it after a
  Worker restart. Awaiting final automated validation and review.
- **2026-09-18:** Replaced the initial singleton-row schema with `user_id` as
  requested. The local Worker hardcodes `single-user`; future Access integration
  will use validated Access JWT `sub`. Added migration 2 to preserve local
  development state; new installations create the user-keyed schema directly.
- **2026-09-18:** Added project-wide readability guidance and auto-fixing ESLint
  padding rules. Prettier continues to own standard code formatting; ESLint owns
  semantic spacing between declarations, control flow, and returns.
- **2026-09-18:** Implemented Hono route composition and shared HTTP middleware.
  Preserved diagnostic flags, guard order, cache policy, revision conflicts,
  explicit 404/405 responses, and streamed inspection limits. Non-object
  preference JSON now fails envelope validation with a controlled 400; uncaught
  HTTP errors use a JSON 500. Next slice remains 3.4 after review.
- **2026-09-18:** Completed 3.4 manual topic management over the local Agent
  diagnostic: independent topic CRUD/pause, global settings, optimistic
  revision conflicts, browser validation, and persistence verification across
  reload and Worker restart. Temporary test data was removed. Next is 3.5
  model evaluation after review.
- **2026-09-18:** Accepted 3.4 and committed the Agent, Hono, readability, and
  manual topic-management work. Added concrete inherited global values to
  topic override controls. Next is 3.5 model evaluation.
