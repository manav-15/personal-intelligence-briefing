# Implementation plan

Last updated: 2026-09-19. Maintain this plan after each increment or scope
decision. Record evidence, limitations, and review status; do not mark a whole
milestone complete when only a smaller slice is delivered.

## Original milestones

| Increment                                   | Deliverable                                                                                                   | Acceptance criteria                                                                                                                  | Status                                                         |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------- |
| **1. Git, stack, hygiene**                  | Initialize Git on `main`; scaffold minimal React/Worker application; configure tooling, documentation, and CI | Fresh install, local startup, and all baseline checks pass; you review stack and structure before features                           | Completed; foundation committed                                |
| **2. Discovery/evidence feasibility**       | Google News adapter, publisher-link resolution, bounded article extraction, fixtures for your three topics    | Demonstrate relevant results, usable article text, working links, and explicit failure outcomes from Workers; report actual coverage | Feasibility delivered with limitations; local inspection added |
| **3. App shell and persistent preferences** | Five responsive screens, singleton agent, SQLite migrations, editable preferences, propose/apply flow         | Preferences survive reload/restart; prompt-controlled summary style is preserved; rejected proposals change nothing                  | Completed and accepted                                         |
| **4. Manual briefing**                      | Generate-now Workflow, ranking, deduplication, citations, Today and Archive                                   | Produces a useful briefing across all three topics; exclusions and length hold; retries cannot duplicate publication                 | In progress: 4.1 awaiting review                               |
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

### 3.5–3.6 — Direct topic proposal review and Apply: completed and accepted

Use Workers AI `@cf/meta/llama-3.3-70b-instruct-fp8-fast`. Model comparison is
deferred. The Topics screen now turns one topic-scoped natural-language
request into a stored, validated `TopicProposal`, then presents a review card
with the current and proposed topic before the user may apply or discard it.

Keep the model identifier and prompt version in one small configuration module.
Limit both input context and output tokens, require structured JSON, and validate
every response with the existing Zod contracts before storage or rendering. A
failure, malformed response, unsupported request, unresolved question, or stale
revision leaves preferences unchanged. Do not add a model registry or a general
evaluation framework.

The application does not store, aggregate, or estimate LLM usage. Cloudflare's
Workers AI dashboard is the sole billing and neuron-usage source of truth. When
reviewing the live smoke set or real use, inspect that dashboard against its UTC
daily reset boundary. Do not retain raw model prompts or responses as usage
telemetry.

Use the following staged evaluation rather than a model bake-off:

1. **Deterministic contract checks in CI.** Fixture responses cover valid add
   and edit proposals, invalid JSON, schema-invalid values, ambiguity, a stale
   base revision, global-scope escape attempts, exclusions, and duplicate topic
   identifiers. These tests never invoke Workers AI.
2. **Small live smoke set outside CI.** Use the Topics UI for 8–12 curated
   requests covering the
   initial interests, concise/deep and audience changes, exclusions, an
   ambiguous request, and an instruction that asks to alter global settings.
   Human review labels each output correct, partly correct, or unsafe; record
   the result without treating semantic wording as an exact automated oracle.
3. **Real-use review.** After local use and again after the first deployed use,
   inspect the Workers AI dashboard for daily neuron consumption. A seven-day
   projection above 10,000 neurons/day triggers review of request bounds and a
   smaller model; it does not silently change the model.

At the current published rate (4,625 neurons per million input tokens and
30,475 per million output tokens), an illustrative 1,000-input/350-output-token
proposal uses about 15 neurons. That is roughly 650 such requests within the
10,000-neuron daily free allocation, before other Workers AI work. This is an
estimate, not a cost guarantee: live provider usage and future briefing calls
must be measured separately.

The Agent owns proposal records in Durable Object SQLite. Apply retrieves the
stored record, rechecks its base revision and scope, validates the complete
resulting preferences document, saves it atomically, and marks the proposal
applied. Discard changes only proposal status. The browser never submits a
model-generated preference patch.

## Increment 4: manual briefing in small reviewable slices

### 4.1 — Briefing contract and durable publication foundation: implemented, awaiting review

Define validated shared contracts for a briefing, its cited story items,
collection limitations, and lifecycle status. Add Agent-owned SQLite migrations
and small interfaces to read a dated briefing, list archive metadata, start a
manual run record, and publish one complete result atomically. A publication is
identified by a generated run ID and snapshots the preference revision used for
the run. Do not start discovery, retrieval, model calls, a Workflow, or a new
user-facing Generate button in this slice.

Acceptance criteria:

- A fresh Durable Object creates the migration and returns empty Today/Archive
  states without inventing a briefing.
- A validated fixture briefing survives Agent restart and is returned by dated
  Today/Archive read interfaces.
- Repeating a publication for the same run ID cannot create a second briefing.
- A failed or unpublished run cannot replace the latest dated briefing.
- Cited items retain source URL, publisher metadata, evidence tier, and topic
  attribution without storing full publisher articles.
- `npm run check`, Agent interface tests, local Worker API checks, and empty
  Today/Archive browser states pass.

Delivered: shared, strict briefing schemas; SQLite migration 4 for run and
publication records; Agent RPC methods for idempotent run creation, atomic
publication, failure marking, newest briefing reads, and archive metadata; and
read-only local Today/Archive routes and screens. The routes remain behind the
existing local diagnostics binding and return no-store JSON. No collection,
retrieval, model call, Workflow, or Generate action is included.

### 4.2 — Bounded collection and evidence selection

Snapshot enabled effective topics from the preference revision, invoke the
existing discovery/evidence adapters under explicit query, result, byte, and
retry budgets, then normalize exact URL duplicates. Persist only run-scoped
candidate metadata and evidence provenance required for retry and composition.
Report partial provider/evidence failures. No semantic ranking or summaries.

### 4.3 — Grounded manual composition

Use Llama 3.3 70B with bounded selected evidence to classify relevance, group
related stories, identify substantial updates against coverage memory, and
produce a structured cited briefing. Code validates every cited source ID,
exclusion, topic scope, length budget, and evidence tier before publication.
Description fallback remains labelled and cannot support unsupported detail.

### 4.4 — Generate-now Workflow and Today/Archive

Add an idempotent manual launch route that starts a Cloudflare Workflow. The
Workflow owns retries and passes the run ID through collection, composition, and
atomic Agent publication. Today renders the newest dated briefing; Archive lists
prior publications and opens their source links. A run status view explains
partial collection failures. Scheduling remains Increment 6.

### 3A validation

- Topics and global defaults survive browser reload and a local Worker restart.
- Adding/editing one topic preserves others; pause state persists and the
  enabled-topic read interface omits paused topics for future run snapshots.
- Summary wording/overrides survive round trips; invalid input changes nothing.
- SQLite migrations work on a fresh database and repeated startup.
- All five routes work on desktop/mobile; the content lab still works.
- `npm run check`, local API checks, and browser flows pass.

### 3B validation

- Deterministic interpretation fixtures preserve requested style/exclusions and
  reject malformed, ambiguous, scope-escaping, and schema-invalid responses.
- Rejected, ambiguous, invalid, and stale proposals change nothing.
- Model proposals require a non-empty preference narrative; an edit whose
  narrative does not change is rejected before storage.
- Applied changes survive restart and affect only the selected scope.
- The local 3.5 smoke set records human quality labels and validation outcomes;
  CI does not depend on live inference.
- Cloudflare's Workers AI dashboard is reviewed by its UTC daily boundary and
  triggers a documented review when a seven-day projection exceeds 10,000
  neurons/day. The application stores no LLM usage telemetry.
- A local Cloudflare-authenticated end-to-end test created a constrained edit
  proposal, applied it, and restored the original document. The Workers AI
  JSON-mode response was an object (not a JSON string); the parser accepts both
  forms and revalidates either. The response schema pins an edit's topic ID and
  requires non-empty interests, so invalid model output is rejected before it
  can be stored.

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
- **2026-09-18:** Deferred comparative model evaluation. Slice 3.5 now starts
  with `@cf/meta/llama-3.2-3b-instruct`, a local proposal diagnostic, bounded
  live smoke checks, and Workers AI dashboard review. Review request bounds or
  a smaller model if the seven-day projection exceeds 10,000 neurons/day.
- **2026-09-18:** Clarified that LLM usage is monitored only in the Cloudflare
  account. The application will not add LLM usage telemetry or aggregation.
- **2026-09-18:** Combined the proposed diagnostic and later Apply work by user
  decision. Implemented the direct Topics UI flow, stored proposal records,
  explicit Apply/Discard, revision checks, Llama 3.2 3B binding, and deterministic
  route/model-contract coverage. Awaiting local Cloudflare-authenticated smoke
  verification and review.
- **2026-09-18:** Documented interactive Wrangler login and non-interactive API
  token setup for local Workers AI inference. Made the remote AI binding
  explicit; local inference consumes the selected Cloudflare account's usage.
- **2026-09-18:** Documented the one-time `workers.dev` subdomain registration
  required by Cloudflare's remote Workers AI development proxy. Local-only mode
  can run the non-AI UI but cannot exercise topic proposals.
- **2026-09-18:** Ran the approved live 3B smoke path against the local Worker:
  Workers AI produced a scoped AI-topic proposal, explicit Apply persisted it,
  and a revision-checked replacement restored the original content. The final
  document is revision 12 with no pending proposals. Tightened the structured
  output schema/prompt after observed object-form JSON, an empty-interest
  attempt, and an invented edit ID; each was rejected before persistence.
- **2026-09-18:** Changed saved topic cards into accessible inline details
  panels. Users open a topic to inspect all saved and effective settings, then
  choose Edit, pause/resume, or delete from that panel. Added UX-01 for revising
  an ambiguous proposal with its original context retained.
- **2026-09-18:** Added UX-02 as an explicit follow-up to refine the topic
  management experience after real use of topic cards, inline details, and the
  manual editor.
- **2026-09-18:** Made each topic's durable free-form preference narrative an
  explicit part of assisted interpretation. Workers AI now receives the prior
  narrative and new request, then returns the consolidated narrative alongside
  validated structured fields for review.
- **2026-09-18:** Strengthened the topic-interpreter prompt to treat
  `currentTopic.userWording` as the durable narrative and require a new concise
  consolidation for every request. Added model-boundary checks for an empty or
  unchanged edit narrative, with deterministic fixtures for a style-only change.
- **2026-09-18:** Switched topic interpretation to Cloudflare Workers AI
  `@cf/meta/llama-3.3-70b-instruct-fp8-fast` by user decision. Comparative
  model evaluation remains deferred; Cloudflare's dashboard remains the source
  of usage data.
- **2026-09-19:** Implemented 4.1, awaiting review: versioned briefing and
  citation contracts, Agent-owned run/publication migration and idempotency
  interfaces, plus read-only Today/Archive diagnostics and empty browser
  states. Collection, evidence selection, composition, Workflow execution,
  and manual generation remain 4.2–4.4.
- **2026-09-19:** Corrected fresh database initialization: it now creates the
  current `preferences.user_id` schema directly. Migration 2 still upgrades an
  existing version-1 singleton database to the temporary `single-user` key.
