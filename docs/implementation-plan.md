# Implementation plan

Last updated: 2026-09-20. Maintain this plan after each increment or scope
decision. Record evidence, limitations, and review status; do not mark a whole
milestone complete when only a smaller slice is delivered.

## Original milestones

| Increment                                   | Deliverable                                                                                                   | Acceptance criteria                                                                                                                  | Status                                                         |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------- |
| **1. Git, stack, hygiene**                  | Initialize Git on `main`; scaffold minimal React/Worker application; configure tooling, documentation, and CI | Fresh install, local startup, and all baseline checks pass; you review stack and structure before features                           | Completed; foundation committed                                |
| **2. Discovery/evidence feasibility**       | Google News adapter, publisher-link resolution, bounded article extraction, fixtures for your three topics    | Demonstrate relevant results, usable article text, working links, and explicit failure outcomes from Workers; report actual coverage | Feasibility delivered with limitations; local inspection added |
| **3. App shell and persistent preferences** | Five responsive screens, singleton agent, SQLite migrations, editable preferences, propose/apply flow         | Preferences survive reload/restart; prompt-controlled summary style is preserved; rejected proposals change nothing                  | Completed and accepted                                         |
| **4. Manual briefing**                      | Generate-now Workflow, ranking, deduplication, citations, Today and Archive                                   | Produces a useful briefing across all three topics; exclusions and length hold; retries cannot duplicate publication                 | In progress: 4.3.1–4.3.3 awaiting review                       |
| **5. Grounded chat and memory**             | Story follow-ups, persistent conversation history, prior-coverage comparison, deletion controls               | Answers cite available evidence; meaningful updates explain what changed; missing evidence is acknowledged                           | Chat foundation implemented; awaiting review                   |
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

The provider-side time-filter follow-up is tracked as
[DISC-06](data-pipeline.md#9-improvement-backlog). Current filtering can miss
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

### 4.2 — Bounded collection and evidence selection: implemented, awaiting review

Snapshot enabled effective topics from the preference revision, invoke the
existing discovery/evidence adapters under explicit query, result, byte, and
retry budgets, then normalize exact URL duplicates. Persist only run-scoped
candidate metadata and evidence provenance required for retry and composition.
Report partial provider/evidence failures. No semantic ranking or summaries.

Delivered: each run snapshots the complete validated preferences document and
fixed collection budget. A collection module compiles enabled topics into
provider-neutral queries, makes a configured private SearXNG pass followed by
bounded Google News and GDELT fallback passes, applies exact source-URL
deduplication with topic attribution, applies literal exclusions and
blocked-publisher checks, and retrieves bounded evidence for a capped candidate
set. Provider exceptions become attributable partial failures, so other
providers and queries continue. Temporary evidence and collection failures
persist only while the run is active; publication or failure removes evidence
rows. SearXNG configuration is a
single private Cloudflare Container with no public route; its Worker binding
will be supplied by the later generation Workflow. Its Durable Object-managed
container sizing is platform-controlled and will be measured on first deploy.

The 12-query, 8-results-per-query, 36-candidate, and 12-evidence-fetch limits
are snapshot defaults. Provider retry is explicitly zero until Workflow retry
and backoff behavior is introduced in 4.4. The result contains no relevance
ranking, source preference ranking, semantic exclusion matching, freshness
policy, summary, model call, or user-facing generation route.

The fair per-topic/provider scheduler is tracked as
[DISC-07](data-pipeline.md#9-improvement-backlog).

Validation: deterministic collection fixtures cover deduplication, multi-topic
attribution, article evidence, and query budgets. An in-memory SQLite Agent test
covers migration 5, snapshots, temporary collection persistence, and deletion
after publication. `npm run check` passed with 122 tests. A local persisted
Durable Object upgraded to versions 1–5; `briefing_runs` now has
`collection_snapshot` and `collection_failures`, and Today still returned its
empty state without modifying saved preferences.

### 4.3 — Grounded manual composition

Implemented 4.3.1–4.3.3 as one reviewed increment: a deep composition module
that accepts a run snapshot, bounded temporary evidence, and seven days of
compact prior published coverage, then returns a validated in-memory briefing draft or a structured
composition failure. It owns candidate packing, prompt construction, strict
model-output validation, source/citation materialization, and limits; callers
do not assemble prompts or trust model-provided links.

The Llama 3.3 70B call receives normalized topic intent (`userWording`,
interests, exclusions, effective summary/source settings), candidate IDs,
metadata, evidence tier/text, collection limitations, and compact seven-day prior
coverage. It does not receive secrets, raw provider errors, or an authority to
choose URLs. The model returns selected candidate IDs, a presentation topic,
headline, summary, update references, `whatChanged`, and a relevance assessment
with a short reason. The assessment has bounded `topicFit` (0–5),
`briefingValue` (0–3), and `novelty` (0–2) fields. Code calculates the 0–100
score as `topicFit * 10 + briefingValue * 10 + novelty * 10`; the model does
not supply an opaque aggregate. Code also derives citations, publishers, topic
IDs, publication dates, and completeness from the selected candidates.

The prompt defines relevance bands rather than asking for an unexplained score:
0–24 unrelated/excluded; 25–49 tangential or weak; 50–69 relevant but weak,
duplicate, or insufficiently material; 70–84 clear fit; and 85–100 high-priority,
well-supported material or a substantial update. It requires the assessment
reason to cite the supplied topic intent, evidence, competing candidates, and
prior coverage. The calculated score ranks eligible items and supports
evaluation; it never overrides code-enforced exclusions, evidence tiers,
source/citation integrity, or output budgets. Article evidence may support
grounded claims; description evidence may support only a labelled limited item;
headline-only evidence is not selectable.

Prior coverage is additionally capped at 12 items, selected by active-topic
intersection and recency, with each prior headline/summary limited to 500
characters. The model request also caps current evidence at 2,500 characters
per candidate and 36,000 evidence/prior-coverage characters in total. One
composition call is permitted per run. These are deterministic cost controls,
not application-side usage telemetry: neuron usage remains monitored in the
Cloudflare Workers AI dashboard. EVAL-01 records request/output sizes and the
dashboard-observed usage for its manual runs before any cap changes.

Deterministic tests use a fake model to cover strict prompt payloads, bounded
packing, malicious text treated as data, malformed/dangling/duplicate candidate
IDs, evidence-tier restrictions, topic-profile conflicts, citation construction,
length limits, partial limitations, and prior-update references. A separate
live EVAL-01 run across AI, world news, and Liverpool records grounding,
citation integrity, relevance calibration, style adherence, and supported
updates. CI never calls Workers AI or publishes a briefing.

This increment deliberately stops before a public Generate action, Workflow,
retry behavior, or database publication; those remain 4.4. Description fallback
remains labelled and cannot support unsupported detail.

### 4.4 — Generate-now Workflow and Today/Archive

Add an idempotent manual launch route that starts a Cloudflare Workflow. The
Workflow owns retries and passes the run ID through collection, composition, and
atomic Agent publication. `GET /api/briefings/today` derives the current date
from the saved preference timezone and returns only that exact dated briefing or
`null`; the browser does no date filtering. Archive lists prior publications and
opens their source links. A run status view explains partial collection failures.
Scheduling remains Increment 6.

Before enabling retries, classify failure boundaries. A Workflow may retry an
unexpected Worker or Durable Object infrastructure failure only where the step
is idempotent or its durable side effect proves the work completed. It must not
blindly repeat bounded discovery or the one-call composition step after an
ambiguous provider/model outcome. The concrete retry policy is deferred to its
own reviewed design before 4.4 implementation.

#### 4.4.1 — Server-owned Today selection: implemented, awaiting review

`GET /api/briefings/today` now asks the Agent for the exact date in the saved
timezone. The Agent formats the date from a supplied clock, queries only that
stored date, and returns no older fallback. The browser client calls this
server-owned endpoint and renders its `briefing`/`null` response without date
logic. Deterministic tests cover the Asia/Kolkata day boundary and absent exact
date. Workflow launch, status, and generation remain the next 4.4 sub-slice.

#### 4.4.2 — Manual Workflow, normal run status, and local Today flow: implemented, awaiting review

`POST /api/briefings/generate` reserves one Agent-owned active run and starts a
Workflow with that UUID as its instance ID. The Workflow persists collection
output before its one composition call, publishes atomically, and cleans up
temporary evidence on either terminal path. Collection and composition have no
automatic retry; idempotent publication may retry twice. A failed run retains
a bounded terminal message and attributed collection failures.

`GET /api/briefings/runs/:runId` is a normal same-origin product API, scoped to
the authenticated owner once Access is configured. It is deliberately not a
diagnostic endpoint: the browser polls it every two seconds until `published`
or `failed`, refreshes Today after publication, and renders persisted failure
reasons after failure. The local Workflow uses `SEARXNG_BASE_URL` when set so
the loopback Compose service is exercised; deployed Workers use the private
Container binding.

Validation: deterministic route, client, Agent, and composition tests pass.
The local loopback service produced publisher text in the bounded verifier. A
live local Workflow then reached `published`; Today returned a partial
four-item briefing with 17 disclosed limitations after upstream/evidence
failures. The published payload confirms end-to-end mechanics, not source
quality or daily coverage.

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

- **2026-09-19:** Implemented 4.4.4 retained candidate metadata, awaiting review.
  `npm run check` passed formatting, lint, typechecks, 153 tests, and production
  build. The local Worker migrated successfully; a live failed run retained 32
  discovery occurrences across six queries in roughly 18 KB of diagnostic JSON.
  Geopolitical returns were eight undated SearXNG items and eight stale Google
  News items; GDELT failed. The browser retained the previous briefing and showed
  the terminal failure. Automated tests verify metadata survives publication and
  failure, article text is absent, owner scoping holds, old runs return null, and
  the diagnostic route is disabled without its local binding.

- **2026-09-19:** Completed the combined Today review implementation (4.4.3),
  awaiting review. The full `npm run check` gate passed 151 tests, lint,
  typechecking, formatting, and the production build. Browser/Worker checks
  covered live partial publication, progress recovery after reload, full archive
  reads, invalid-edition retry UI, and mobile width. Preserved source-quality
  limits under DISC-03, BRIEF-01, EVAL-01, and COST-01; no deployment occurred.

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
- **2026-09-19:** Implemented 4.2, awaiting review: run snapshots, bounded
  Google News/GDELT collection, exact URL deduplication, topic attribution,
  bounded evidence retrieval, temporary run-scoped evidence storage, and
  persisted partial failures. No semantic selection, model composition,
  Workflow, or manual launch route was added.
- **2026-09-19:** Added enforced ESLint complexity ceilings. The initial limits
  match the highest pre-existing complexity while blocking regressions; the new
  collection loop was split into helpers to meet the three-level nesting limit.
- **2026-09-19:** Expanded 4.2 by decision: configured SearXNG is first in
  collection when available, with Google News and GDELT as fallbacks. Added a
  private, one-instance Cloudflare Container configuration using the local
  pinned image/settings; deployment and fair scheduling remain separate work.
- **2026-09-19:** Hardened 4.2 collection review findings: provider exceptions
  now become bounded partial failures, and failing a run deletes its temporary
  candidate evidence in the same SQLite transaction.
- **2026-09-19:** Implemented 4.3.1–4.3.3, awaiting review: bounded seven-day
  prior coverage, one Llama 3.3 70B composition call, strict model-output
  validation, code-owned citations, relevance scores, update provenance, and
  in-memory draft generation. No route, Workflow, or database publication was
  added; those remain 4.4.
- **2026-09-19:** Reduced enforced cyclomatic complexity from 35 to 20. Split
  SearXNG response handling and story normalization, publisher-host safety
  checks, and content-lab card rendering into named helpers while preserving
  their public behavior. A stricter 10 threshold remains a future refactoring
  target after this baseline is established.
- **2026-09-19:** Implemented 4.4.1 server-owned Today selection, awaiting
  review. The API now returns only the briefing for the date derived in the
  saved preference timezone; it does not return the newest prior briefing.
- **2026-09-19:** Implemented 4.4.2, awaiting review: manual Workflow launch,
  atomic reserve/publish/fail behavior, normal same-origin run-status polling,
  terminal failure persistence, and Today generation feedback. Local SearXNG
  is running on loopback. A live run published a partial four-item briefing;
  upstream/evidence limitations remained disclosed.

### 4.4.3 — Today reliability and reading experience: implemented, awaiting review

On 2026-09-19 the user authorized all four slices of the Today review plan
as a combined increment. Discovery and evidence selection now rotate across
enabled topics before spending their shared remainder. Candidate retention is
fairly capped; collection eligibility uses the inclusive preceding 24 hours at
the Workflow's fixed timestamp, excluding future and unknown dates. This is
search-reported freshness, not verified publisher dating (DISC-03).

Composition snapshots topic names, deduplicates reader-facing warnings, names
uncovered topics, discloses short editions, validates an upper reading budget
of 220 words per requested minute, and uses a story-scaled output allowance
capped at 6,000 tokens. Exact previously covered headlines cannot be selected
as new; zero-novelty items are omitted. Broader semantic calibration remains
BRIEF-01/EVAL-01. Short outputs remain valid rather than padded.

Today restores the durable latest run, polls serially every two seconds after
each completed read, preserves a visible edition during refresh, distinguishes
load failures from absence, and prevents repeated submissions. Workflow
terminal status reconciles failed reservations; a 30-minute reservation timeout
fences abandoned work. Collection/composition timeouts are 10/3 minutes with no
automatic provider/model retries; publication and failure marking are idempotent.
Archive entries now open complete immutable editions. Today links the latest
prior edition when today's edition is absent, without misdating it.

The reading surface has responsive editorial typography, actual reading time,
friendly topic links, accessible source descriptions, visible change explanations,
and expandable coverage details. Raw collection diagnostics remain on run records.

Validation: deterministic collection, composition, Workflow, Agent, route, client,
and serial-polling regression coverage; local frontend/Worker and live generation;
reload restored a disabled generation control while work continued; archive links
opened the retained full edition. The mobile DOM measured 390px with no horizontal
overflow. The live run published a short partial edition after provider failures
and publisher 403s, not evidence of comprehensive topic coverage. Final quality gate
results are recorded in the update log below. Relevant backlog: DISC-03, DISC-07,
BRIEF-01–03, UX-03, EVAL-01, COST-01. Next work is governed by those IDs after review.

### 4.4.4 — Retained candidate metadata: implemented, awaiting review

The user requested small metadata for temporary candidates after a historical run
could not distinguish empty discovery from filtering or editorial omission.
Migration 7 adds `briefing_runs.collection_diagnostics`. Each completed collection
stores per-query topic/provider/query/status/counts and per-return title, URL,
publisher, reported date, filtering/budget outcome, evidence tier, and evidence
size/truncation or bounded failure reason. No snippets or article bodies are copied.

Metadata survives both publication and failure while temporary evidence is deleted.
An opt-in local `GET /api/briefings/runs/:runId/diagnostics` read returns retained
metadata plus published source URLs, allowing final inclusion to be identified.
The existing small polling contract is unchanged. Pre-migration runs return null
metadata; their candidates cannot be reconstructed. The trace starts at normalized
adapter output, not the raw provider response, and is persisted when collection
finishes; interrupted pre-storage collection has no retained trace. Counts are
query occurrences, so URLs may appear under several queries/topics.

The normal 12-query/8-result budget bounds the trace to 96 occurrences; the schema
allows at most 60 queries and 1,500 occurrences for supported larger budgets.
Metadata stays with its run for now; retention/deletion policy remains STORE-01.
No production diagnostic route is enabled. Acceptance and validation are recorded
under STORE-02 in the canonical backlog. Next slice remains subject to user review.

### 4.4.5 — Publisher-date recovery: implemented, awaiting review

SearXNG results without a search-supplied date no longer fail freshness before
one bounded recovery attempt. Collection spends at most six shared evidence
requests, rotates them across topics, and extracts publication dates from
JSON-LD `datePublished`, recognized HTML metadata, then semantic `time` markup.
The recovered fetch is reused as the candidate's evidence, preventing a second
publisher request. Recovered dates remain subject to the original fixed run
clock, source exclusions, and future/stale checks; page URLs, snippets, and
models cannot infer freshness.

The run diagnostic now records recovered dates and their provenance. A
read-only retrospective of the last run recovered dates from 17 of 25 undated
publisher pages, with five fresh at the run time and three returning readable
evidence. Validation covers JSON-LD precedence, metadata and time fallbacks,
freshness re-evaluation, and evidence reuse. The next live generation should
measure the actual inclusion rate before changing the shared budget or relaxed
article-type policy.

Local workflow validation then published run
`9953941c-7867-4db0-85dc-c143c8c77aba`. It recorded three recovered JSON-LD
dates, all stale at that run's fixed clock, and published a partial one-item
edition despite Bing connection errors and a Google News CAPTCHA suspension.
An initially rejected live draft exposed an empty model-summary item; the
composition guard now discards that individual item rather than failing the
whole edition, with deterministic regression coverage.

### 4.4.6 — Discovery and evidence quality evaluation: implemented, awaiting review

Run a small, separately recorded live evaluation across the enabled topics and
several days or controlled query fixtures. For each topic, measure SearXNG
engine failures, returned-date availability, publisher-date recovery rate,
fresh recovered candidates, evidence retrieval success, relevance rejection,
and final inclusion. Keep the current six-request recovery share and one model
call per run; the work is measurement and diagnostics, not a budget expansion.

Add per-candidate contributing-engine metadata to the retained diagnostic trace
so the app can distinguish a missing date from Brave, DuckDuckGo, Google News,
or Reuters. Add a deterministic article-type guard that rejects index, tag,
and live-timeline pages unless they can be identified as a discrete article.
Validate that a publisher-recovered stale date remains excluded, that a fresh
article can reach composition with its provenance, and that diagnostics expose
the engine and rejection reason without retaining snippets or article text.

Review the measured results before altering engine configuration, the date
recovery share, the evidence size limit, or relevance policy. If SearXNG Google
News CAPTCHA suspension materially harms fresh evidence coverage, begin
conditional backlog item DISC-08: add the existing Google News RSS adapter's
publisher-link decoder behind the same normalized discovery contract.

Local evaluation run `470562d3-7b1f-4a87-ad18-faa0dccdcd01` covered three
enabled topics and 72 returned occurrences. Bing connection failures and Google
News CAPTCHA suspension made every query partial; Google contributed no retained
candidate. Brave supplied the sole fresh publisher-date-recovered article,
DuckDuckGo supplied most stale and description candidates, and Reuters supplied
only stale candidates. The run failed honestly because no item met the complete
relevance, novelty, and evidence policy. The report is reproducible with
`npm run evaluate:briefing-run -- 470562d3-7b1f-4a87-ad18-faa0dccdcd01`.

## Increment 5.1 — Grounded chat foundation: implemented, awaiting review

`PersonalBriefingAgent` remains the single durable owner of preferences,
briefings, and chat. It now extends `AIChatAgent` for WebSocket transport and
reconnect recovery, while explicit `chat_sessions` and `chat_messages` Durable
Object SQLite rows retain the product-visible history. Each session is bound to
one published briefing run and story, carries its briefing date/headline for
the archive, and can be reopened after reload. React uses `useAgent` and `useAgentChat` at
the private `/agents/personal-briefing/single-user` route; Static Assets sends
that route to the Worker rather than SPA HTML.

Each turn must identify an owned saved briefing run and one story in that
edition. The Agent validates both, builds a bounded source-labelled system
context from the selected item, its stored update note, and code-owned
citations, then calls Workers AI Llama 3.3 70B. It receives no discovery or
general browsing tool and never accepts model-generated URLs. The UI renders
only the selected story's stored source links. When today has no edition, the
screen selects the most recent saved edition so next-day follow-ups remain
useful.

The first attempted streamed evidence-refresh tool exposed duplicated Workers
AI tool-input fragments in local testing. The foundation therefore answers from
the source-backed saved briefing summary and clearly instructs the model not to
claim it read the full article. Bounded publisher evidence refresh remains a
follow-up after an adapter-compatible tool path is verified. Session deletion
removes the application's stored session and messages; owner-scoped deletion of
briefing records remains STORE-01.

Validation: deterministic context, input, and Workers AI response parsing tests
pass. A local Worker and browser loaded the selected-story UI and its source
links. A live Agent WebSocket request for the saved carbon-emissions story
returned one clean answer: PM Modi's stated emissions comparison and climate
action call, attributed to `[S1]`. The persisted response was inspected through
the Agent message route. Full quality-gate results remain required before
review.

Follow-up: product-visible history is now explicit rather than inferred from
the Agent transport transcript. Migration 8 adds `chat_sessions` and
`chat_messages`; list/create/read/delete HTTP routes are same-origin and
`no-store`. A local description-only session survived separate API reads and a
browser reload with both user and Agent turns, then correctly reopened its
original archived briefing and citation. The next live answer included `[S1]`;
code now adds the selected story's first code-owned label if the model omits it.
