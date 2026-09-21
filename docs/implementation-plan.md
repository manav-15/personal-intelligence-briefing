# Implementation plan

Last updated: 2026-09-21. Maintain this plan after each increment or scope
decision. Record evidence, limitations, and review status; do not mark a whole
milestone complete when only a smaller slice is delivered.

## Current status: security, SearXNG-only discovery, chat and composition (2026-09-21)

The working tree contains the route-security fixes (SEC-01), SearXNG-only
discovery with private Container wiring (DISC-10 / DEPLOY-01), the removal of the
retired Google News and GDELT providers, recent chat history and UI request
handling (CHAT-02), and a portable test alias (TEST-01). These changes await
review; none has been deployed in this increment.

Feasibility diagnostics require the local inspection flag, identity and origin
checks. Agent routing validates the personal-briefing binding and owner for every
suffix. SearXNG is the only briefing discovery provider; multiple configured
engines provide redundancy, and engine errors retain their diagnostics without
removing useful results. The Google News and GDELT adapters, the Google
publisher-link decoder, their verification scripts, and the Google redirect branch
of evidence retrieval were deleted; no fallback path remains. Retained runs still
parse because the persisted provenance enum keeps the retired names.

Chat now selects the latest 12 messages for model context and the latest 200 for
the displayed transcript, in chronological order. Older rows remain stored.
Conversation actions are serialized, stale refresh responses are ignored, and
request/transport errors are shown. The test runtime alias resolves relative to
the repository rather than a developer's absolute path.

One chat turn is now sent as three ordered turns: system policy, one untrusted
JSON data block holding the story, then the transcript whose final message is the
question. Article text, the briefing summary, the change note, and the question
left the system message, JSON escaping prevents forged role or turn markers, and
`buildChatMessages` makes the ordering directly testable. Citation-label
validation after generation remains open under CHAT-03.

Composition no longer loses an edition to one contradictory model item (BRIEF-04,
closing BRIEF-05). A selection that references an unknown candidate, repeats a
candidate, names a topic outside its own group, groups incompatible topic
profiles, or claims an unsupported update is discarded while the rest of the
draft publishes, and the edition carries one `composition-rejected` limitation
naming the reason. A model that returns more items than the story limit now has
its lowest-relevance surplus dropped with a `story-budget` limitation. Whole-run
failure remains for unparseable model output, an empty candidate set, and a draft
whose every selection was discarded, and that message names the discards. The
prompt also states that a presentation topic must belong to the item's own
candidates, and the composition prompt version is `2026-09-21.2`.

### Validation already performed

- Current working tree: the complete `npm run check` gate passes on Node 24 —
  formatting, lint, strict type checks, 209 tests across 20 files, and the
  production build. The earlier states recorded 224 tests (security-only) and 220
  tests (before the provider removal); the drop is the deleted Google News,
  decoder, GDELT and mixed legacy test files, offset by publisher-evidence cases
  moved into `evidence.test.ts` and the chat-boundary and composition cases added
  since.
- Composition rejection: `briefing-composition.test.ts` covers every rejection
  category, a mixed draft that publishes the valid story with the
  `composition-rejected` limitation, a draft whose whole selection set was
  discarded, candidate reuse after a rejection, the `story-budget` truncation,
  and the untouched global failures. Live local runs: one published a single
  valid story plus `Discarded 3 selections presenting a topic that did not match
its stories. The edition keeps the remaining stories.` where the previous code
  failed the edition outright; another, with no valid selection, failed with the
  discards named. Three of four items mismatched on that run, so the prompt rule
  added for it did not remove the mismatch cause; that root cause is tracked as
  BRIEF-07, and a bounded repair call as BRIEF-06.
- Live local Worker (`wrangler dev`, production-style bindings with the
  diagnostic flags forced off): `/api/feasibility/discovery`,
  `/api/inspection/search`, and the run-diagnostics route all answered 404 before
  any provider call, while `/api/preferences` and `/agents/*` answered 401 and
  `/api/health` answered 200.
- Live local diagnostics enabled: the feasibility probe returned five AI
  candidates from the local SearXNG instance while retaining a Bing News engine
  error, answered 400 for a one-character query, and answered 403 for a
  cross-origin request.
- Live local Agent routing: a same-origin WebSocket handshake to the owner path
  returned 101, a foreign owner returned 404, a foreign origin returned 403, and
  a path naming the `SEARXNG` Container binding returned 404.
- Direct route tests (`security-routes.test.ts`) pin the same boundaries without
  a live server, including that no provider fetch happens when the flag is off.
- Chat prompt split: `chat-context.test.ts` and the call-site case in
  `preferences-agent.test.ts` prove the system turn holds policy only, that the
  data block carries the story, that an injection payload (`Ignore all previous
instructions` plus a forged `System:` line) stays inside the escaped JSON value,
  and that the current question is the final turn. One live browser turn on the
  local app still answered with [S1] attribution and refused nothing unexpected.
- The pinned Container image builds during local startup, and the local Docker
  instance serves the configured engines. These results do not establish hosted
  Container startup or hosted engine coverage.

Remaining validation is tracked under TEST-01, CHAT-02 and CHAT-03. Hosted
startup, secret configuration and generation verification remain DISC-10 /
DEPLOY-01. No hosted generation, new remote AI inference, or deployment was
performed.

### Deployment performed (2026-09-21, after review)

`SEARXNG_SECRET` was generated and stored as a Worker secret, the pinned SearXNG
image was built and pushed to the Cloudflare registry, and `npm run deploy`
published Worker version `3896ea3a-2b1c-49a0-8565-407c9a3c3181` with the
container application `personal-intelligence-briefing-searxngcontainer`
(`instance_type: lite`, `max_instances: 1`, tiers 1-2) to
`personal-intelligence-briefing.chiraniamanav15.workers.dev`. The Access policy
answers 302 to the login flow for `/`, `/api/health`, and `/api/briefings/today`,
so the hostname is protected before the Worker runs. Containers require a Workers
Paid plan; the previous free-tier decision is therefore superseded by this
deployment.

Not yet verified: a hosted generation through the Container. `wrangler
containers instances` reports no live instance because the Container starts on
demand, and the only caller is the authenticated generation route, so the check
needs a signed-in session or an Access service token.

### Scope and next slice

Manual generation is the submission scope; SCHED-01 and DISC-11 are deferred, and
the schedule settings still read as if active until SCHED-01 is picked up.
SearXNG engine and publisher errors are expected and must remain visible. Current
work has stopped at documentation completion. The next implementation work, when
resumed, follows the existing backlog entries; this section is not a second
TODO list. Historical milestones below describe earlier scope and evidence.

Update log: 2026-09-21 (fourth entry) — composition now discards a contradictory
model selection per item, discloses it as one `composition-rejected` limitation,
truncates a surplus above the story limit, and names the discards when nothing
usable remains (BRIEF-04, BRIEF-05 dropped, BRIEF-06 and BRIEF-07 opened). Live
local runs confirmed both the published-subset path and the all-discarded
failure. Prompt history entry appended for this increment.

## Original milestones

| Increment                                   | Deliverable                                                                                                   | Acceptance criteria                                                                                                                  | Status                                                         |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------- |
| **1. Git, stack, hygiene**                  | Initialize Git on `main`; scaffold minimal React/Worker application; configure tooling, documentation, and CI | Fresh install, local startup, and all baseline checks pass; you review stack and structure before features                           | Completed; foundation committed                                |
| **2. Discovery/evidence feasibility**       | Google News adapter, publisher-link resolution, bounded article extraction, fixtures for your three topics    | Demonstrate relevant results, usable article text, working links, and explicit failure outcomes from Workers; report actual coverage | Feasibility delivered with limitations; local inspection added |
| **3. App shell and persistent preferences** | Five responsive screens, singleton agent, SQLite migrations, editable preferences, propose/apply flow         | Preferences survive reload/restart; prompt-controlled summary style is preserved; rejected proposals change nothing                  | Completed and accepted                                         |
| **4. Manual briefing**                      | Generate-now Workflow, ranking, deduplication, citations, Today and Archive                                   | Produces a useful briefing across all three topics; exclusions and length hold; retries cannot duplicate publication                 | In progress: 4.3–4.4.10 awaiting review                        |
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
JavaScript: query the configured news engines, filter returned search-reported
dates against inclusive rolling UTC ranges, then cap results. Every range
carries a one-day buffer: day = 2 days, month = 32 days, year = 366 days.
Filtered searches exclude undated/future leads.

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

- **2026-09-21:** Removed the code-owned citation append from chat, at the owner's
  direction. `ensureChatCitation` appended `[S1]` to any answer that contained no
  label, which was defensible while outside knowledge was forbidden and became
  fabrication once knowledge was allowed: a knowledge-only answer would have been
  attributed to the story's first source, and the client renders that label as a real
  link. The function and its two tests are gone, the answer is stored exactly as the
  model produced it, and the attribution instruction now says labels are the model's
  to add because no code adds them afterwards. Verified in the browser: a story-fact
  answer carried [S1] from the model itself, and a knowledge answer came back under
  "Background:" with no invented label. The cost is explicit — attribution is now
  instruction-dependent, and the code-owned sources aside is the only label surface.
  Prompt policy version 2026-09-21.4.
- **2026-09-21:** Reworked the grounded-chat prompt at the owner's request. It had told
  the model to use no outside knowledge and never to claim to have read the article,
  which the stored history shows it obeying literally: "I can only use the provided
  text to answer questions. I don't have prior knowledge to draw upon." The prompt now
  supplies two kinds of information — the briefing context including the retained
  article extract, and the model's own general knowledge — requires knowledge to be
  introduced with "Background:" instead of a source label, and states that it cannot
  query the internet or any other source. Two supporting changes were needed:
  `ensureChatCitation` no longer appends a source label to an answer already marked as
  background, and the system prompt now names the latest question, because a
  twenty-message session anchored the model on the previous thread and it answered the
  wrong question twice. Verified in the browser: the article-text question returned
  detail only the extract contains (2.3 seconds from 2.8, 60 languages, 29 speech and
  31 text-only), a knowledge question answered under "Background:" with [S1] kept for
  the story facts, and a lookup request was refused explicitly. Prompt policy version
  2026-09-21.3.
- **2026-09-21:** Put SearXNG back in service locally at the owner's direction, with
  Google News and Brave excluded, and verified a new topic end to end. The engine
  set needed the general `duckduckgo` engine added: with the news category alone,
  the football topic returned zero results, and after the change Liverpool FC
  Premier League returned 40 results with 40 dates while artificial intelligence
  returned 42 with 32 dates. A new Semiconductor industry topic was saved as
  revision 4 and generated run `078602f0`, which published a 7-item edition: two
  article-tier items (pulse2.com, MarkTechPost) and five labelled description-tier
  items whose publishers could not be retrieved (msn.com three times, insidermonkey,
  atvtoday). Two limitations are recorded: `bing news` fails every query with HTTP
  connection errors and marks those queries partial while still contributing results
  intermittently, and a long-running SearXNG instance had gone silent on every
  engine except reuters until restarted, which a hosted container must handle.
- **2026-09-21:** Measured the captcha-free alternative to scraping, after the owner
  reported that SearXNG's Google engine reaches a captcha wall. Publisher RSS
  answered 200 with direct publisher links and dates (BBC World 27 items, Guardian
  World 45, Sky Sports Premier League 20) and the Hacker News Algolia API answered
  200 with direct publisher URLs, while Reddit's JSON endpoint answered 403 and
  GDELT stayed intermittent. Article retrieval from the same edge returned real
  body text (BBC and Guardian at 600-1,041 words, Sky Sports news at 932), so a
  feed-and-API channel would give both discovery and evidence without a container,
  a paid plan, or any scraping. Recorded as DISC-11 with the choice it needs —
  curated registry or per-topic configuration — and folded the measurements into
  DISC-10. Probe Worker deleted.
- **2026-09-21:** Measured engine reachability from Cloudflare's egress, because
  that decides whether restoring SearXNG is worth the paid plan. DuckDuckGo's HTML
  endpoint answered 200 with publisher links, Mojeek 200 with result links, Bing
  and Startpage 200 without extractable result links, and Google 429 — the same
  block that stops the Google News decoder. A containerised SearXNG should
  therefore resolve publisher URLs through DuckDuckGo and Mojeek without needing a
  dedicated IP, which Cloudflare only sells as an enterprise add-on. Recorded in
  DISC-10; probe Workers deleted.
- **2026-09-21:** Corrected a claim about container egress while answering whether
  the Worker can have its own IP. Cloudflare's documentation offers dedicated
  egress only as enterprise add-ons — Smart Shield's Dedicated CDN Egress IPs,
  which do cover Worker `fetch()` to external origins, and Zero Trust's dedicated
  egress IPs, which apply to Gateway-proxied device traffic — so a Container would
  not have given a distinct egress IP even though SearXNG would still have removed
  the need for Google's blocked decoder by returning publisher URLs directly.
  DISC-10 now states this and adds the option of running the provider-facing piece
  on an IP the owner controls, with engine reachability from Cloudflare's range to
  be measured before paying for the paid plan.
- **2026-09-21:** Recorded why the first hosted generation published nothing. The
  run started (so the deployment is configurable and the preference gate is
  satisfied) and ended with the complete-failure path the specification asks for:
  `No eligible evidence is available for composition.` with the prior edition
  retained. Composition refuses at `candidates.length === 0`, and a probe Worker on
  Cloudflare's edge shows why: the Google News decoder's `batchexecute` POST
  answered HTTP 429 on every attempt regardless of user agent, its interstitial
  page exposes no publisher URL, and GDELT answered 429 for two of three topic
  queries even spaced six seconds apart, though one earlier query returned 20
  dated articles whose URLs were publishers. Both blockers are properties of
  Workers' shared egress, not of the code, and the collection reported them rather
  than padding the edition. Recorded as DISC-10 with the decision it needs; the
  probe Worker was deleted after use.
- **2026-09-21:** Fixed a first-run trap the hosted app exposed. A new deployment
  shows the suggested topics while none are stored, and the UI labelled that list
  "Saved topics" with the status line reading "Using initial defaults", so the
  owner read the suggestions as saved configuration; generation then refused with
  the API's `Save preferences before starting a briefing.` Today also offered an
  enabled Generate button, making that refusal the first the user heard of the
  precondition. The client now says the topics are not saved, the list is labelled
  "Suggested topics, not saved", Today explains the precondition and links to
  Topics with generation disabled until something is saved, and the stale advice
  to start the local Worker with `PREFERENCES_DIAGNOSTICS_ENABLED=true` is gone.
  Verified in a browser against the deployed response shape (`configured: false`
  intercepted) and against the saved local document, which is unchanged. Recorded
  UX-05 for a single action that adopts the suggested topics.
- **2026-09-21:** Made the deployment configurable. The preferences route group
  applied `diagnosticEnabled('PREFERENCES_DIAGNOSTICS_ENABLED')` to `'*'`, so with
  diagnostics disabled — the deployment's configuration — reads, saves, and topic
  proposals all answered 404 and neither settings nor a first generation were
  reachable. Preference access is ordinary application behaviour, so the group gate
  is removed while authentication, the missing-binding 503, same-origin, and method
  checks are unchanged; the flag now guards only the run-diagnostics route and
  local inspection. Tests encode the deployed configuration directly — Access
  configured, flag absent, valid token served, anonymous still 401, run diagnostics
  still 404 — and the token fixtures moved to `src/test/access-tokens.ts` so the
  router tests can reuse them. Recorded because the earlier "not a production
  settings API" statements in `README.md` and the plan were wrong.
- **2026-09-21:** Restored local development, which Access protection had broken
  in two ways. `npm run dev` could not start at all: the remote-binding session
  that `ai.remote` requires reaches the deployed Worker and therefore wanted
  `cloudflared`, so that binary is now installed (2026.9.1, no background
  service). With it running, the local API then answered 401 `Sign in through
Cloudflare Access to use this app.` — the committed Access values applied to the
  local Worker — so `.dev.vars` (gitignored) blanks both bindings and
  `configuredValue` treats an empty value as unconfigured, which is the mechanism
  that makes the blanking work; a test pins it. Verified locally in a real
  browser: the app renders Today with a stored edition and `/api/briefings/today`
  returns 200. Recorded BRIEF-05 from the same session: a model decision naming a
  presentation topic outside its own candidates throws
  `Presentation topic does not match selected candidates.` and loses the whole
  edition, the same whole-run failure mode as BRIEF-04 but from a different guard.
  DEV-01 is complete.
- **2026-09-21:** Access went live on the hosted Worker, and the first signed-in
  request exposed a runtime-only defect. The application and policy are configured
  in Zero Trust, the AUD tag joined `ACCESS_TEAM_DOMAIN` in `wrangler.jsonc`
  `vars` (committed; neither is a credential), and `ec409d3e` deployed both.
  Anonymous traffic to the whole hostname now redirects to the Access login —
  `/`, `/api/health`, `/api/briefings/today`, and `/agents/*` all answer 302 to
  `briefing-agent.cloudflareaccess.com` — so the Worker's verifier is a second
  layer rather than the only gate.
  Every guarded route then answered 401 `Cloudflare Access keys could not be
fetched.` with a valid session. Cause, proven on Cloudflare's edge with a
  throwaway probe importing the real module: the Workers runtime brands `fetch`,
  so the verifier's `input.fetcher(...)` call passed the request object as
  receiver and threw `TypeError: Illegal invocation`; the broad catch in
  `keysFor` reported that as unfetchable keys. Node's `fetch` tolerates a foreign
  receiver, so all 202 tests and every local run stayed green, and `access.ts` was
  the only property call site for a fetcher in the codebase. Fixed by borrowing
  the fetcher into a local before calling it, with a regression test whose fetcher
  throws unless called with no receiver — it fails against the previous call form
  and passes against this one — deployed as `d9903c9c`. Every denial now also
  records its reason through `console.warn`, which is what made the failing branch
  visible in `wrangler tail`; the token, cookie, and claims are never logged.
  Two follow-ups recorded: DEV-01 (local `npm run dev` cannot start while the
  deployment is Access-protected, because the remote-binding session that
  `ai.remote` needs wants `cloudflared`) and EVAL-02 (the suite runs under Node,
  where branded Workers globals accept a foreign receiver). Hosted generation and
  channel coverage stay unverified until a signed-in session completes one run.
- **2026-09-21:** Recorded repository-driven infrastructure as DEPLOY-04 at the
  user's request, deferred to a later increment: a GitHub remote plus an Actions
  workflow that gates on `npm run check` and deploys, with the Access application
  and policy managed as code so the AUD tag is generated rather than copied.
  Documented the two Access policy shapes in `docs/deployment.md` — Cloudflare
  account members, which needs no domain and is available now, and an email
  domain, which needs a verified domain added to the account — including the note
  that `ACCESS_ALLOWED_IDENTITIES` keeps account membership from being sufficient
  on its own. No code changed and nothing was deployed.
- **2026-09-21:** First deployment, by user instruction. `npm run deploy` shipped
  version `2bdddc6b-a7a5-4ebb-9715-4c535e54af71` to
  `https://personal-intelligence-briefing.chiraniamanav15.workers.dev` on the
  Workers **Free** plan: the Durable Object export was created, the
  `briefing-workflow` Workflow was provisioned, and Worker startup measured 66 ms
  with no container image. Verified live: `/api/briefings/today`, `/api/chats`,
  and `/agents/personal-briefing/single-user` all return 401 ("Authentication is
  not configured for this deployment"), `/api/preferences` and the inspection
  route return 404 because their local bindings are absent, `/api/health` answers
  200 as the documented public health check, and `/` serves only the 515-byte app
  shell. The emitted client bundle was checked for the team domain, the account
  id, the secret names, and the account subdomain: absent, so nothing sensitive is
  public while Access is still being set up. Remaining: the Access application,
  its AUD tag, and `ACCESS_AUD`.
- **2026-09-21:** Prepared the deployment so it is one command, after review
  found that Access cannot admit anything until an application exists — and an
  application cannot be scoped to a Worker that has not been deployed. Added
  `npm run deploy` and `npm run deploy:dry-run` (build plus
  `wrangler deploy --config wrangler.jsonc`), set `workers_dev` to `true` for the
  free `workers.dev` hostname while keeping `preview_urls` false, and documented
  both Access routes in `docs/deployment.md`: the account-level "Protect all
  Workers" switch, which works before the Worker exists, and the narrower
  per-Worker toggle, which needs it deployed. `npm run deploy:dry-run` validates
  in about four seconds with three bindings and no container image. Nothing was
  deployed.
- **2026-09-21:** Implemented the Access verification slice and removed the only
  paid-plan dependency, awaiting review. New `src/server/access.ts` resolves one
  request identity from `Cf-Access-Jwt-Assertion` or the `CF_Authorization`
  cookie: RS256 verified with Web Crypto against the team's JWKS (cached, with a
  single refresh on an unknown key id), exact issuer match, audience check, expiry
  with five-second skew, and an optional identity allowlist that also matches
  service-token `common_name`. It fails closed: a missing token, a bad signature,
  another application's audience, an expired token, an unreachable key set, or an
  unconfigured deployment all produce a bounded 401. `requireIdentity` guards the
  preferences, briefings, and chats routes plus `/agents/*`, the hardcoded
  `localUserId` is gone from every route, the Agent route refuses an instance name
  that is not the resolved owner, and the local `single-user` placeholder survives
  only under the local diagnostic binding. Twelve deterministic tests cover the
  acceptance set with an in-process RSA keypair and a fixture JWKS.
  By user decision SearXNG is disabled for now, which removes the container from
  `wrangler.jsonc` together with its Durable Object binding and secret and drops
  the Workers Paid requirement; collection runs the decoded Google News RSS
  channel plus GDELT, the Workflow opts in only under `SEARXNG_BASE_URL`, and
  `infra/searxng/` plus the container class are parked for local Docker
  verification. `--config wrangler.jsonc` dry-run now validates in under a second
  with three bindings and no image build. `npm run check` passes 22 files and 202
  tests. No cloud resources were created and nothing was deployed.
- **2026-09-21:** Recorded two hosting decisions from review. Hostname: start on
  the free `workers.dev` address, which needs no zone, so Access is the only
  account-level setup required; `workers_dev` flips to `true` and `preview_urls`
  stays `false`. Access can protect a `workers.dev` host either through the
  Worker-level "Protect with Access" toggle or a self-hosted application naming
  that host, and either path still yields the AUD tag the Worker needs because
  verification depends on the team domain and AUD rather than the hostname.
  Identity API: `ctx.access.getIdentity()` exists, but with Static Assets an
  internal router sits in front of the script and does not pass that context
  through, so this Worker keeps its own JWT verification and treats the platform
  identity as an optional post-deploy measurement, never the only check.
  `docs/deployment.md` now covers both hostname paths. No code changed and nothing
  was deployed.
- **2026-09-21:** Confirmed Option A for access identity and wrote the deployment
  runbook. Option A keeps one application-level owner id with Access as the gate,
  superseding the earlier note about deriving the Durable Object key from the JWT
  `sub`; per-user agents and storage were recorded as future scope under the new
  DEPLOY-03 backlog item, with `resolveAccessIdentity` and `idFromName` named as
  the seams that change. `docs/deployment.md` now carries the prerequisites
  (Workers Paid, a zone, Zero Trust, Docker for the image build), the manual
  dashboard steps (team domain, login method, application, AUD tag, allow policy,
  optional service token), the command steps, the post-deploy verification
  checklist, and the values the Worker configuration needs. The safe order of
  operations is recorded explicitly: land the fail-closed auth code, deploy, then
  attach Access, so there is no window in which the API is reachable and
  unauthenticated. No cloud resources were created, nothing was deployed, and no
  code changed.
- **2026-09-21:** Expanded the P2 hosting phase into a concrete Access
  implementation plan (no code yet). Verified Cloudflare's contract against its
  documentation: `Cf-Access-Jwt-Assertion` (case-insensitive, with the
  `CF_Authorization` cookie for browsers), JWKS at
  `https://<team-domain>.cloudflareaccess.com/cdn-cgi/access/certs`, exact issuer
  match on the team domain, the application's AUD tag as audience, RS256 only,
  and — the two details most likely to be got wrong — service-token JWTs carry an
  **empty `sub`** with the identity in `common_name`/`service_token_id`, and
  Access validates the WebSocket upgrade only, never mid-connection. Recorded the
  module boundary (`resolveAccessIdentity`), fail-closed rules, JWKS rotation
  handling, an identity allowlist as defence in depth, and a deterministic test
  list using an in-process RSA keypair. Flagged one decision for review: keep one
  application-level owner id and treat Access purely as the gate (recommended, and
  supersedes the earlier "use the JWT `sub`" note) rather than deriving the
  Durable Object key from `sub`, which is empty for service tokens and would start
  hosted data from an empty database.
- **2026-09-21:** Recorded the deployment plan as Increment 6 scope (hosting now,
  daily trigger later). `npx wrangler deploy --dry-run --config wrangler.jsonc`
  validated the deployment posture without publishing anything: the pinned
  SearXNG container image builds from `infra/searxng/Dockerfile`, five client
  assets are read, the Worker bundles to 2.97 MB (582 KB gzip), and all four
  bindings resolve (`PERSONAL_BRIEFING`, `SEARXNG`, `BRIEFING_WORKFLOW`, `AI`).
  The same check exposed a real defect in the documented deploy command: the Vite
  plugin redirects Wrangler to `dist/<worker>/wrangler.json`, where `assets` is
  rewritten relative but the container Dockerfile path is not, so the documented
  `npx wrangler deploy` aborts on a missing file. Readiness gaps recorded: no
  authentication exists and `localUserId` is hardcoded, so Access protection must
  precede any exposure; no `observability` block; `SEARXNG_SECRET` exists only as
  a local Docker value; and deletion/retention (STORE-01) plus the two reliability
  guards (BRIEF-04, BRIEF-01) remain open before unattended runs. No cloud
  resources were created and nothing was deployed.
- **2026-09-20:** Implemented 4.4.10, awaiting review: chat can now read the
  article behind a published story. Migration 9 adds `briefing_evidence`;
  publication copies one bounded extract (≤12,000 characters) per cited source
  from the temporary evidence before it is deleted, using the article body when
  usable and the attributed description otherwise, and the chat turn supplies
  those extracts with their tier and retrieval time. The chat prompt now states
  that the extract may be incomplete and that the live page may differ. This is
  an explicit, reasoned exception to storing citations and metadata only, taken
  to fix follow-ups that could answer only from a one-sentence summary; it can be
  revisited if chat moves to on-demand retrieval. `npm run check` passed
  formatting, lint, typechecks, 185 tests, and the production build. Verified
  live through the browser: for run `2d4b7f5e`'s Qwen story the answer named the
  Interleave architecture and the `qwen3.8-livetranslate-flash-realtime` endpoint
  over WebSocket, none of which appears in the stored summary. No deployment or
  credential changes.

- **2026-09-20:** Verified the fresh-install path by deleting the entire local
  state directory and rebuilding from scratch. The Worker returned
  `{configured:false}` with no saved document, migrations 2–9 applied in one pass,
  and every application table existed with zero rows before any user data was
  written. Restoring the saved preferences document through the normal API
  (`expectedRevision: 0`) produced revision 1, and the first generation then
  published a four-item partial edition in 71 seconds retaining article text for
  its three article-tier items (5,286–6,969 characters) and the 152-character
  description for its description-tier item — the first live exercise of
  description retention. Transient candidate evidence was deleted as designed
  (`briefing_candidates` empty). Asking the same UIDAI follow-up that previously
  answered "the briefing context does not provide specific details" now returned
  the plan's named focus, proof-of-concept work, and the OCI legal-framework
  intent, still disclosing that specifics were absent from the retrieved text.

- **2026-09-20:** Implemented 4.4.9, awaiting review: SearXNG's Google News and
  Brave News engines are disabled, every date-range filter carries a one-day
  buffer, the briefing's own eligibility window is now an inclusive two days
  (one-day target plus the same buffer, by user decision), and Google leads are
  freshness-filtered and newest-first ordered before decoding. Disabling the two
  engines cut SearXNG engine failures in a
  three-topic collection from 14 to 4 (bing news only) and left 7 of 12 queries
  `ok`; the trade-off is fewer dated results, since Bing and DuckDuckGo mostly
  return undated ones. `decodeGoogleNewsStories` now marks stale/future leads
  `date-ineligible` without fetching them and attempts the newest eligible lead
  first, so run `f76e90ab` spent all four decodes on fresh leads where the
  earlier run wasted one on a stale lead. That run published a two-item partial
  edition. `npm run check` passed formatting, lint, typechecks, 179 tests, and
  the production build. Review also caught a real duplicate: a second same-day
  run republished an already-covered story under an identical headline and URL by
  asserting a substantial update drawn from the same article, which the
  exact-headline guard cannot detect (recorded under BRIEF-01). No deployment or
  credential changes.

- **2026-09-20:** Implemented 4.4.8: normal runs now collect from SearXNG and
  the decoded Google News RSS channel together, awaiting review. `providerCalls`
  no longer returns SearXNG alone; it always includes Google News RSS, adds the
  private SearXNG channel when configured, and keeps GDELT only without SearXNG
  (live GDELT requests are still rate-limited). The run-wide decode budget is now
  divided across the scheduled Google queries, so one topic can no longer spend
  all of it. `npm run check` passed formatting, lint, typechecks, 178 tests, and
  the production build. Live multi-channel collection against the local container:
  six SearXNG queries returned eight candidates each but every query was `partial`
  (Bing connection errors, Google News CAPTCHA); six Google News RSS queries
  returned eight each and were `ok`; 48 RSS leads (30 stale by RSS date), four
  decode attempts, three publisher-linked leads, and five collected candidates
  (three usable articles, one description, one headline-only). Two real
  generate-briefing runs then exercised the Workflow path: both traces recorded
  both channels, the second published two article-tier items with one supplied
  only by the decoded Google News channel, and the first failed at composition on
  a pre-existing model-output guard now tracked as BRIEF-04. Decode-budget tuning
  and freshness-first decoding are tracked as DISC-09. No deployment or credential
  changes.

- **2026-09-20:** Implemented 4.4.7 (DISC-08) Google News publisher-link
  decoding, awaiting review. The decoder had been written but left the tree red:
  the budget schema capped decodes at 20 while a fixture used 24,
  `collectBriefingCandidates` exceeded the complexity limit, and the live Google
  article page had grown to roughly 591 KB against a 200 KB bound, so every real
  decode failed closed. The bound is now 1 MB, the collection loop is split into
  named helpers, and leads left unresolved by the budget or a challenge stay in
  the diagnostic trace as `decode-failed` instead of vanishing before it. Live
  check: three of three RSS leads decoded and all three publisher pages returned
  usable article text with matching JSON-LD dates. Review caught that the Workflow
  still configures SearXNG, whose exclusive channel selection bypasses the RSS
  adapter entirely, so no normal generate-briefing run reaches the decoder yet;
  DISC-08 is Partial and enabling the channel is the next decision. No deployment
  or credential changes.

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
fairly capped; collection eligibility uses the inclusive preceding two days at
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

### 4.4.7 — Google News publisher-link decoder: implemented, awaiting review

DISC-08 was conditional on the SearXNG Google News CAPTCHA suspension materially
limiting fresh evidence coverage. Run `470562d3` met that condition: Google News
was suspended and contributed no retained candidate. This increment adds the
decoder the feasibility scripts had already verified, behind the same normalized
discovery contract.

`discovery/google-news-decoder.ts` resolves one Google RSS item to its publisher:
it fetches the Google article page, reads the `data-n-a-sg` signature and
`data-n-a-ts` timestamp, posts them to the undocumented `batchexecute` endpoint,
and validates the returned external URL. It performs no retries and no CAPTCHA
workarounds. Collection decodes before deduplication, so exact-URL dedupe,
blocked-source checks, and evidence retrieval all operate on the publisher URL,
and a decoded lead keeps its Google link as `discoveryUrl`.

Cost and honesty bounds: two requests per decode with a 1 MB page bound; one
run-wide `maxGoogleNewsDecodes` budget (default 4, schema ceiling 60) shared
across Google queries and disclosed once when exhausted; a lead the budget or a
challenge leaves unresolved is never fetched, keeps its Google link in the
retained diagnostic trace with the new `decode-failed` outcome, and leaves the
query's `returned` count as the provider's actual return count.

Limitations: the protocol is undocumented and may change, rate-limit, or
challenge automated requests; the article page has grown before (200 KB → over
590 KB on 2026-09-20), and a page that outgrows the bound fails closed as an
unresolved lead. The decoder supplies a link, not evidence quality: publisher
access still determines whether retrieval succeeds. Reachability is the larger
limitation: `providerCalls` returns the SearXNG channel alone whenever SearXNG is
configured, and the Workflow always configures it, so this increment changes no
normal generate-briefing run yet. Enabling the Google News channel alongside
SearXNG — with its query, decode, and evidence budget shares — is the next
reviewable decision, not an automatic consequence of this work.

Validation: `npm run check` passes. Interface tests cover article-ID shape, the
two-request protocol, challenge and malformed envelopes, credential/Google-URL
rejection, unresolved-lead retention with no evidence fetch, and the decode
budget disclosure. A live check on 2026-09-20 decoded three of three RSS leads
and retrieved usable article text for all three publisher pages (BBC 3,688,
TechCrunch 4,631, Guardian 5,876 characters) with matching JSON-LD publication
dates. Slice 4.4.8 then enabled the channel: `providerCalls` adds the decoded
Google News channel to every run alongside a configured SearXNG instance and
splits the decode budget across the scheduled Google queries. Next slice:
raise the decode default against measured yield and decode only date-eligible
leads first (DISC-09), then re-evaluate composition relevance on the richer
candidate set.

### 4.4.8 — Google News channel enabled alongside SearXNG: implemented, awaiting review

The Workflow always configures SearXNG, and `providerCalls` previously returned
that channel alone, so the Google News adapter — and therefore the decoder — never
ran in a normal briefing. This slice makes the channels additive: every run
includes Google News RSS, includes SearXNG when configured, and keeps GDELT only
on the non-SearXNG path because live GDELT requests still return 429.

The run-wide `maxGoogleNewsDecodes` budget (default 4) is now divided across the
scheduled Google queries, mirroring the fair topic order and the evidence
allocation. Without that split, the first topic's Google query consumed every
decode and later topics received none.

Measured live against the local SearXNG container on 2026-09-20 with the default
budget: six SearXNG queries each returned eight candidates but every one was
`partial` — `bing news: HTTP connection error` and `google news: CAPTCHA` — while
six Google News RSS queries returned eight each and were `ok`. The run produced 48
RSS leads of which 30 were stale by RSS date, four decode attempts (the default
budget, one per Google query for the first four), three publisher-linked leads,
and five collected candidates: three usable articles and one description from
SearXNG, plus one headline-only Google News item (BBC, Liverpool) that SearXNG had
not supplied. Total run duration was roughly 31 seconds.

End-to-end validation through the real Workflow and the local Worker, same day:
two `POST /api/briefings/generate` runs were started and their retained traces
read back. Both recorded the two channels — one run seven SearXNG and five Google
News queries, the other six and five — with the Google News queries `ok` while
every SearXNG query stayed `partial` (Bing connection errors, Google News
CAPTCHA). One run failed at composition with `New coverage cannot claim a
previous item.`, a pre-existing guard that rejects a model item marked as new
coverage while claiming prior items; the run history shows comparable model-driven
failures before this change (`error code: 1031`, a Zod rejection, and no-eligible
stories), and the second run published. The published edition carried two
article-tier items, and one of them — a story both channels did not share — was
supplied only by the decoded Google News channel. A story both channels returned
deduplicated to a single item. The composition guard is tracked as BRIEF-04.

Diagnostics: review of the recorded runs showed the single `decode-failed`
outcome was conflating two different states, so it is now split — `decode-failed`
means an attempt ran and returned nothing (challenge, invalid envelope, HTTP
failure), `decode-budget` means the run's allowance never reached that lead. The
conflation hid the real finding: neither recorded run had any endpoint-level
decode failure. Every budgeted attempt succeeded, and all 13 `decode-failed` marks
were leads whose query share was `0` or already spent. A failed decode also marks
its query `partial`, which the tests now cover alongside the split.

Limitations: the default decode budget of four leaves most fresh RSS leads
unresolved and, with five or six Google queries, gives the last one no decode at
all. One of four attempts in the recorded run was spent on a lead that was stale
by RSS date, so decoding still happens before the date gate. Both are the tuning
targets under DISC-09, recorded rather than silently accepted.

### 4.4.9 — Engine set, buffered ranges, and freshness-first decoding: implemented, awaiting review

Three changes were requested together: stop using the two engines that could not
supply usable dated results, widen each application range filter by a day, and
make the date gate apply before a decode is spent.

`infra/searxng/settings.yml` disables SearXNG's `google news` and `brave.news`
engines; `google news` is CAPTCHA-suspended and `brave.news` returns results
without publication dates. The `brave` web engine stays defined but disabled
because the news engine shares its network configuration and startup fails with
`KeyError: 'brave'` when the parent is removed. The pinned image and settings
remain shared between local Compose and the private Cloudflare Container.

`discovery/searxng.ts` adds `RANGE_BUFFER_DAYS = 1`, so the Worker window is the
requested range plus one day: day → 2 days, month → 32 days, year → 366 days.
Engine timestamps are rounded to the day and can lag the publisher, so the
strict boundary dropped results that belong to the range.

`decodeGoogleNewsStories` now classifies every returned lead before spending the
allowance. Stale and future leads become `date-ineligible`, are never fetched,
and keep their date rejection in the trace; eligible leads are attempted
newest-first with undated leads last. The lead-state refactor also preserves
provider order in the retained diagnostics instead of regrouping by outcome.

Measured against the local container on 2026-09-20, same three topics and
defaults: engine failures fell from 14 to 4 (bing news only), engines used were
duckduckgo news 33 / reuters 22 / bing news 16, and 7 of 12 queries reported
`ok`. Run `f76e90ab` decoded four of four attempts on fresh leads (16:14, 16:09,
06:35, previous evening) where the earlier run spent one of four on an already
stale lead, and it published a two-item partial edition. One item replaced an
ft.com source that returned 403 with an accessible business-standard.com article
about the same event, which is the same-event replacement the fallback policy
describes.

The briefing's own eligibility window carries the same buffer. By user decision,
`FRESHNESS_WINDOW_DAYS = 2` in `dateRejectionReason` replaces the fixed
twenty-four hours, so a story published late on the previous day is eligible
while future and undated leads stay excluded. A boundary test asserts that a lead
exactly two days old is accepted, that one second older is stale, and that the
stale lead is never decoded.

Verified live: livemint's Aadhaar story carried a 2026-09-19T08:32 RSS date, was
decoded and rejected as `stale` by the twenty-four-hour gate in run `e5da082e`,
and is the published item of run `d238bf97` under the two-day window. Run
`d238bf97` published in 30 seconds with 10 failures. The intervening run
`6278590e` collected successfully and then failed at composition on the
contradictory-update guard, which has now failed two of the last six live runs
(BRIEF-04).

Limitations: fewer results now carry a usable date, because Brave News was one
of the few dated sources, and SearXNG result sets vary enough between runs that
single-run stale counts are not comparable — the 24-hour and 48-hour runs showed
45 and 41 stale SearXNG leads, but the later windows run returned 55 stale of 55
because its own results were older. Raising the decode default stays open
pending a yield measurement (DISC-09), and the run also exposed a same-day
duplicate-publication path that needs a deterministic prior-URL check (BRIEF-01).

### 4.4.10 — Retained article text for grounded follow-ups: implemented, awaiting review

Follow-ups about the UIDAI story could only restate a 171-character summary and
correctly reported that the briefing context lacked detail. Investigation showed
why: the extracted article body was fetched during collection, used for the
summary, and then deleted with the rest of the run's temporary evidence at
publication, so nothing about the article survived for chat. The model was not
failing; there was nothing for it to read.

By explicit user decision, one bounded extract per cited source is now retained
in a side table rather than deleted. Migration 9 adds `briefing_evidence`
(`run_id`, `item_id`, `source_url`, `publisher`, `evidence_tier`, `retrieved_at`,
`characters`, `truncated`, `text`). Publication copies the text inside its own
transaction: the extracted article body when the evidence is usable, otherwise
the attributed description that supported a description-tier item, capped at the
existing 12,000-character extraction limit and flagged when truncated.
Headline-only sources contribute nothing.

The chat turn reads those rows for its session's run and item and supplies them,
labelled `[S1] retained <timestamp>` and divided across the item's sources so a
multi-source item still shows each one a fair window. The prompt states the
extract is bounded and may differ from the live page, and keeps the requirement
to say what is missing rather than claim a full read. Earlier briefings have no
retained text and say so explicitly.

Cost and scope: measured extracts run 3.8k–7k characters, so an edition of ten
items is roughly 53 KB and a year of daily editions about 19 MB — inside the
included Durable Object allowance by orders of magnitude. The real cost is the
model input, roughly +3,000 tokens per turn against a ~280-token context today,
about +14 neurons at the recorded rate. Retention is deliberately the one
exception to the "no article copies" rule and is revisited if chat later moves
to on-demand retrieval.

Validation: `npm run check` passes 185 tests. Tests cover the context with and
without retained text, the across-source cap, publication retention for cited
usable sources, owner scoping, the truncation ceiling, and description-tier
retention. Live browser verification on run `2d4b7f5e`: the Qwen story's answer
reported the Interleave architecture and the `qwen3.8-livetranslate-flash-realtime`
endpoint over WebSocket, details present only in the retained article text.
Deletion of retained rows with their briefing remains STORE-01.

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

## Increment 6: Cloudflare hosting — plan, not started (2026-09-21)

Scope decided by the user: host the current system on Cloudflare, and treat the
daily trigger as a later increment. Backlog owners are
[DEPLOY-01](data-pipeline.md#9-improvement-backlog) (private hosted SearXNG +
deployment), [DEPLOY-02](data-pipeline.md#9-improvement-backlog) (Access
protection), [COST-01](data-pipeline.md#9-improvement-backlog) (usage and
budgets), with reliability prerequisites under BRIEF-04, BRIEF-01 and STORE-01.
Scheduling stays [SCHED-01](data-pipeline.md#9-improvement-backlog) and is
explicitly out of scope for this increment.

### Readiness assessment

Proven by `npx wrangler deploy --dry-run --config wrangler.jsonc`: five client
assets are read, the Worker bundles, and the bindings resolve —
`PERSONAL_BRIEFING` (Durable Object), `BRIEFING_WORKFLOW`, and `AI`. No container
is built, so the deploy needs no Docker and the deployment fits the Workers Free
plan. Migrations 1–9 were separately verified on a deleted state directory, and
the first generation on that fresh database published a four-item edition, so
schema bootstrapping is not a deployment risk.

**SearXNG is disabled for now, by user decision.** Collection runs the decoded
Google News RSS channel plus GDELT, which is what removes the paid-plan
requirement: the only feature that needed Workers Paid was the container. The
code is parked rather than deleted — `infra/searxng/` and `searxng-container.ts`
remain for local Docker verification, the Workflow opts in only when
`SEARXNG_BASE_URL` is set, and the container is gone from `wrangler.jsonc` along
with its Durable Object binding and secret. Re-enabling the hosted path means
restoring that binding and the paid plan.

Runtime paths remain environment-aware: the diagnostic surfaces — local
inspection (`INSPECTION_ENABLED`) and run diagnostics
(`PREFERENCES_DIAGNOSTICS_ENABLED`) — return 404 unless their binding is exactly
`true`, so neither ships enabled. The preferences routes are not among them:
reads, saves, and topic proposals are gated by authentication and origin only,
because a deployment that cannot be configured cannot run at all.

Remaining gaps before a hosted deployment:

1. **Authentication is implemented but not yet wired to a live Access
   application.** `src/server/access.ts` plus the route and Agent middleware now
   require a verified JWT (see P2 detail). What is left is account-level: create
   the Access application, then set `ACCESS_AUD`. Until that value exists the
   Worker rejects every request by design.
2. **Deploy mechanics are ready.** `npm run deploy` and `npm run deploy:dry-run`
   wrap the build plus `wrangler deploy --config wrangler.jsonc`; the flag is
   required because the Vite plugin redirects Wrangler to a generated
   `dist/<worker>/wrangler.json` whose relative paths do not all resolve.
3. **Operational blind spots.** No `observability` block, so hosted logs are not
   retained; nothing measures hosted usage against the sub-USD-10–20 target
   (COST-01); and there is still no deletion path for briefings, retained
   evidence, or the unimplemented 90-day deduplication memory (STORE-01).

### Phases

**P1 — Pre-flight and deploy mechanics (done).** `workers_dev` is `true` so the
free `workers.dev` address is the app's hostname, `preview_urls` stays `false`,
and `npm run deploy` / `npm run deploy:dry-run` wrap the real command. Still
owed: an `observability` block, and a check that a production configuration
cannot set `SEARXNG_BASE_URL` and silently change the channel list.

**P2 — Access protection: code implemented, application pending (DEPLOY-02).**
`src/server/access.ts` verifies the Access JWT and `requireIdentity` guards every
API route and the Agent route; the hardcoded `localUserId` is gone from all
routes. What remains is account-level: create the Access application, then set
`ACCESS_AUD` (`ACCESS_TEAM_DOMAIN` is already configured as
`briefing-agent.cloudflareaccess.com`). Full design below. _Acceptance when the
application exists:_ a browser session signs in and works; a token from another
Access application, an expired token, or a tampered signature is rejected; and
local development still works without Access.

**P3 — First deployment (DEPLOY-01).** Deploy with `--config wrangler.jsonc` and
verify the deployed Worker against the hosted channels. No container and no
container secret are involved. _Acceptance:_ `/api/health` is unreachable without
an Access session, one manual generation publishes an edition from the hosted
Worker, diagnostic routes return 404, and hosted engine coverage (which of Google
News RSS and GDELT respond, and how many results carry dates) is recorded with
its limitations.

### P2 detail — Access implementation

**Contract to implement against** (Cloudflare's documented values):

| Value                | Where it comes from                                                                                      |
| -------------------- | -------------------------------------------------------------------------------------------------------- |
| JWT header           | `Cf-Access-Jwt-Assertion`, case-insensitive; browsers also carry `CF_Authorization`                      |
| JWKS                 | `https://<team-domain>.cloudflareaccess.com/cdn-cgi/access/certs`                                        |
| Issuer               | `https://<team-domain>.cloudflareaccess.com` — the team domain, never the app URL                        |
| Audience             | the Access application's AUD tag; `aud` arrives as an array                                              |
| Algorithm            | RS256 only; never accept an algorithm named by the token                                                 |
| User claims          | `sub` (IdP subject), `email`, `exp`, `iat`, `nbf`                                                        |
| Service-token claims | `sub` is **empty**, identity is in `common_name` / `service_token_id`, plus `service_token_status: true` |

**Identity mapping — decided: Option A.** Keep one application-level owner id
(`PRIMARY_USER_ID`, defaulting to the existing `single-user`) and treat Access as
the gate plus an allowlist, so the browser and a service token reach the same
Durable Object and the current local data model is unchanged. This supersedes the
earlier note that intended to derive the id from the JWT `sub`: service tokens
carry an empty `sub`, and a `sub`-derived key would have started hosted data from
an empty database.

**Future scope — per-user identity (DEPLOY-03).** The user recorded that the
longer-term direction is one Agent and isolated storage per authenticated user.
Option A is therefore deliberately a single-user gate, not a multi-user design:
the identity seam (`resolveAccessIdentity`) is the place that changes, and
`idFromName` becomes identity-keyed, but nothing else in this plan presumes a
single owner can never become many. `docs/deployment.md` records the same
limitation.

**Deployment runbook.** `docs/deployment.md` carries the ordered dashboard and
command steps, the safe order of operations (fail-closed code → deploy → Access
application), the values the Worker configuration needs, and the post-deploy
verification checklist.

**Hostname — decided: start on `workers.dev`.** No zone or custom domain is
needed; the account's free `workers.dev` subdomain is enough, and Access protects
it the same way (either the Worker-level "Protect with Access" toggle, which
creates the application, or a self-hosted application naming the workers.dev
host). This requires flipping `workers_dev` to `true` in `wrangler.jsonc` — which
is precisely what keeps the Worker unreachable today — while leaving
`preview_urls` false, since preview URLs are a separate surface that is easy to
leave unprotected. Moving to a custom domain later only repoints the Access
application and updates the AUD tag, because verification depends on the team
domain and AUD, not the hostname.

**Do not depend on `ctx.access`.** Cloudflare exposes an Access identity to
Worker code (`ctx.access.getIdentity()`) without JWT parsing, but with **Static
Assets** an internal router sits in front of the script and does not pass that
context through — and this Worker uses Static Assets with `run_worker_first` for
`/api` and `/agents`. The Worker therefore verifies the Access JWT itself.
`ctx.access` can be measured after the first deploy as an optional fast path, but
never as the only check, and its absence must remain a rejection rather than a
fallback.

**Worker module (`src/server/access.ts`).** One deep entrypoint —
`resolveAccessIdentity(env, request): { ok: true; userId } | { ok: false; status; message }`
— that owns token extraction (header, else `CF_Authorization` cookie), JWKS
caching, signature and claim verification, and the allowlist check. Routes and
the Agent consume only that result, so no handler parses a token itself.

- **Fail closed.** When the Access bindings are configured, a missing, malformed,
  expired, wrong-issuer, or wrong-audience token is a 401 and never a fallback.
  The local `single-user` placeholder is returned only when the Access bindings
  are _absent_ and the local diagnostic binding is exactly `true`.
- **Key rotation.** Cache the JWKS in module scope with a TTL and refresh on an
  unknown `kid`; never disable verification when the JWKS fetch fails — that is a
  401, not an allow.
- **Allowlist (defence in depth).** An `ACCESS_ALLOWED_IDENTITIES` binding
  (comma-separated `sub` values and service-token client ids) means a
  misconfigured Access policy cannot silently admit a second authenticated user.
  Trade-off: two places to update when the identity changes.
- **Service tokens** map to the same owner id, so scripted verification
  (`npm run evaluate:briefing-run`, a hosted generate call) reads and writes the
  same data the browser sees. Scripts send `CF-Access-Client-Id` and
  `CF-Access-Client-Secret`.
- **WebSockets.** Access validates the HTTP upgrade only and does not re-evaluate
  mid-connection, so the Agent route must rely on the handshake check and on the
  client reconnecting (the SDK already recovers). Set the Access session duration
  deliberately rather than leaving the default.

**Zero Trust setup (account-level, manual, once).** Enable Zero Trust, choose a
team domain, add an identity provider (one-time PIN by email is enough for one
user), create the self-hosted Access application for the single hostname, add an
allow policy for that identity, and copy the application AUD tag and team domain
into the Worker as configuration. Protect the whole hostname — assets, API, and
Agent — rather than only `/api/*`.

**Tests (deterministic, no network).** Generate an RSA keypair in-process, sign
tokens, and inject a fake JWKS fetcher: valid token accepted; wrong `aud`; wrong
`iss`; expired `exp`; tampered signature; `alg: none` and HS256 rejected; unknown
`kid` triggers one refresh; JWKS outage fails closed; service-token claims map to
the owner id; missing header without Access bindings falls back only under the
local flag; every rejection path returns a bounded message and no stack.

**P3 — First deployment (DEPLOY-01).** Deploy with `--config wrangler.jsonc`.
No container and no container secret are involved. Then record hosted channel
coverage — whether Google News RSS and GDELT answer from Cloudflare's egress and
how many of their results carry dates — because the Worker is their only caller.
_Acceptance:_ the whole hostname redirects to the Access login without a session,
one signed-in generation publishes an edition from the hosted Worker, diagnostic
routes return 404, and the channel-coverage measurement is recorded with its
limitations.

**P4 — Cost and quality measurement (COST-01, EVAL-01).** Read the Cloudflare
dashboard for Worker, Durable Object, Workflow, container, and Workers AI usage
across several hosted runs; confirm or refute the sub-USD-10–20 target; record
relevance/freshness/evidence rates for hosted runs alongside the local ones.
_Acceptance:_ measured usage per run and an explicit budget decision; no
application-side telemetry added.

**P5 — Reliability before unattended operation.** BRIEF-04 (the
contradictory-update guard, recorded in `docs/data-pipeline.md`);
the BRIEF-01 same-day duplicate path; and STORE-01 retention/deletion including
the unimplemented 90-day deduplication memory. _Acceptance:_ a scheduled-style
repeated run cannot lose an edition to one contradictory model item and cannot
republish an already-covered citation.

### Deferred to a later increment

**Repository-driven infrastructure (DEPLOY-04).** Deferred by user decision. When
taken up: push the repository to a GitHub remote, add an Actions workflow that
gates on `npm run check` and deploys with `npm run deploy`, and bring the Access
application and policy under code (Terraform's `cloudflare_zero_trust_access_*`
resources or the Access API) so the AUD tag becomes an output rather than a
hand-copied value. One-time account actions — Zero Trust organisation, team
domain, and login method — stay manual either way.

### Risks and open decisions

- **Container cold start.** `sleepAfter = '10m'` means the first search after an
  idle period pays container startup inside the Workflow's 10-minute collection
  step; the first hosted run should be timed.
- **Egress-IP behaviour** may differ materially from localhost (Bing already
  fails locally; the hosted IP may be treated differently by every engine). This
  is the main unknown for hosted briefing quality, not a code problem.
- **Single-user assumption** is baked into the Agent identity; a second user is a
  separate design, and P2 only enforces that exactly one identity can reach it.
- **Hostname choice** (workers.dev versus a custom domain) and whether the
  container needs a larger instance for the deployed engine mix are deployment
  decisions, not code.
