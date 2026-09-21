# Architecture decisions

## Current implementation (2026-09-21)

This section supersedes the historical provider and scheduling decisions below.
The current pipeline uses SearXNG exclusively. Local development supplies a
loopback Docker URL; production configuration supplies a private Container
binding. Both use the same pinned image and settings. The Worker is the only
production caller, and public Agent routing rejects the Container binding.
Multiple SearXNG engines provide redundancy; useful results survive individual
engine failures and raw failure diagnostics are preserved. The Google News RSS
and GDELT adapters, the Google publisher-link decoder, and their verification
scripts were removed on 2026-09-21: SearXNG is the only discovery provider, and
the local feasibility probe now exercises it instead of a retired channel. An
aggregator redirect link is never treated as article evidence.

Generation is scheduled and still available manually (SCHED-01). A
`*/15 * * * *` Worker cron calls `startDueScheduledBriefing`, which reads only its
own bindings: the Agent decides due-ness from the saved `{ localTime, timezone }`
and reserves one run per local calendar date, then the Worker creates the
Workflow. The tick never enters Hono, so Access identity and same-origin policy do
not apply to it, and the owner id matches the HTTP path
(`PRIMARY_USER_ID || "single-user"`). A tick that is early, has no saved or
enabled topics, already published today, or already has a running reservation is a
silent no-op; a failed run can retry on a later tick, a published date never does,
and a manual request may still publish a second edition the same day. Each run
records its `trigger` (`manual` | `scheduled`) so the two paths stay
distinguishable. The Agent owns
preferences, editions, retained evidence and conversations; the Workflow handles
bounded collection, composition and atomic publication. The private Container
configuration is implemented locally but is not yet deployed or hosted-verified
(DISC-10 / DEPLOY-01).

Chat history selects recent rows before reversing them into chronological order:
12 for model context and 200 for the displayed transcript. Older records remain
stored; pagination and further UI verification are tracked under CHAT-02.
A chat turn is sent as system policy, then the story as one untrusted JSON data
block, then the transcript ending at the current question. Article text, the
briefing summary, and the question never enter the system message, and JSON
escaping stops source text from forging a role or turn boundary.
Conversation actions are serialized and stale refreshes cannot replace the
selected conversation's transcript. The shared origin policy also protects Agent
HTTP and WebSocket routing.

Chat uses the owner the Worker resolved, not a fixed name. `onChatMessage` reads
the Durable Object's own instance name (`idFromName(userId)` is what both the
routes and the cron tick address), and the browser reads the same value from
`GET /api/identity` before it opens the transport — an unnamed or guessed
connection would address a different instance and be refused by the Agent route's
owner check.

The historical sections below explain previous increments. Current validation
and review status are in `implementation-plan.md`; actionable work lives only in
the improvement backlog in `data-pipeline.md`.

## Initial shape

One Worker serves the React assets and first-party routes. A single personal
Agent will later own persistent preferences, conversations, briefings, covered
stories, and run state in Durable Object SQLite. A Workflow will perform the
daily briefing pipeline.

## HTTP composition (2026-09-18)

Pinned Hono 4.13.8 replaces manual Worker dispatch. `src/server/index.ts`
composes the route groups in `src/server/routes/`, preserves the
`PersonalBriefingAgent` export, and adds the `scheduled` handler beside Hono's
`fetch` (SCHED-01). Hono owns HTTP validation and responses; discovery,
evidence, shared Zod contracts, and Agent RPC remain separate. Small middleware
functions handle diagnostic flags, origin rejection, method checks, and cache
headers. There is no controller/service framework.

Guard order is part of the contract:

- Preferences: diagnostic flag → binding availability → origin → method →
  PUT-specific same-origin JSON check → validated envelope/document → Agent RPC.
  Only successful reads/writes receive `no-store`.
- Inspection: `no-store` for the whole trailing-slash prefix → diagnostic flag →
  origin → route/method → evidence-specific Origin/content type → streamed
  16,000-byte limit → JSON parsing and shared schema validation. Unknown children
  retain those guards; the bare `/api/inspection` mount remains a plain JSON 404.
- Health: method check followed by a successful `no-store` response.
- Identity (added 2026-09-21): identity → origin → method → the resolved owner id
  as JSON. Only the successful read receives `no-store`. This is the only route
  that tells the browser which owner it resolved to, so the chat transport can
  address its own Agent instance instead of assuming one.
- Feasibility (updated 2026-09-21): `no-store` → local inspection flag →
  identity → origin → method → provider validation → bounded discovery/evidence.
  Disabled diagnostics return 404 before validation or outbound requests.
- Agent transport (updated 2026-09-21): identity → origin → exact binding and
  resolved owner check on every subpath → SDK dispatch. The SDK owns supported
  transport suffixes; adding a suffix never bypasses the owner check.

Explicit raw-method checks reject HEAD and OPTIONS with 405 and `Allow`;
Hono's implicit HEAD-to-GET dispatch cannot trigger a GET handler. HEAD responses
are bodyless at the HTTP boundary. Unknown API paths return JSON 404s, including
trailing-slash variants, and Wrangler keeps `/api` and `/api/*` Worker-first.
Unhandled exceptions receive a JSON 500 instead of Hono's default text response.

Vite's automatic CORS middleware is disabled so local OPTIONS requests reach
the Worker. It previously returned 204 before dispatch; local responses now
match the explicit Worker policy. The same-origin frontend needs no CORS grant.

Preference input now receives explicit envelope validation before field access
and document validation before RPC, in addition to validation inside the Agent.
Non-object JSON receives the existing `Invalid preference document.` 400 error;
previously some primitives/arrays reached the missing-revision error instead.
Discovery/evidence parsing, limits, persistence, and fallback selection are unchanged.

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
inspection now qualifies descriptions and exposes evidence tiers. Briefing
selection, fallback caps, and composition are not yet implemented.

Discovery will first use Google News RSS search. It is behind an adapter seam so
GDELT can supply a second channel with direct publisher links. Providers live in
separate files under `src/server/discovery`, with shared normalized contracts
and a small barrel entrypoint; there is no plugin registry. Article retrieval is a separate
module: discovery links alone are not evidence for claims.

> Superseded on 2026-09-21: SearXNG is the only provider. The Google News RSS and
> GDELT adapters, their decoder, their verification scripts, and the Google
> redirect branch of evidence retrieval were deleted. The paragraphs below keep
> the measurements that motivated the decision.

GDELT uses one English-language article-list query over the past week, bounded
to 25 results, 750 KB, and a 10-second timeout. Rate limits are explicit
recoverable failures; this adapter does not retry. GDELT's indexing `seendate`
is not a publication timestamp, so publication time remains unknown. Publisher
names currently use the destination hostname. Source-quality ranking and
configurable language/lookback are deferred.

## Run-scoped collection foundation (2026-09-19)

When a briefing run starts, the Agent snapshots the validated preferences and
fixed collection limits. Collection considers enabled topics only, compiles a
topic's search concepts (or its interests when concepts are absent), then uses
a configured SearXNG pass followed by bounded Google News and GDELT fallbacks
per query. It applies literal exclusion and blocked-publisher checks, exact
source-URL deduplication, and retains every matching topic ID. It does not make
semantic relevance or source-quality judgments.

The run may retain bounded retrieved article text in `briefing_candidates` only
while it is active. This allows the later composition/Workflow work to retry or
compose from the same evidence without making it permanent application memory.
The Agent deletes those rows when it publishes a briefing. Provider and evidence
failures are retained with the active run so the later UI can explain a partial
result. Current default limits are 12 discovery calls, 8 results per call, 36
deduplicated candidates, and 12 evidence fetches. Retry budget is explicitly
zero until the Workflow supplies bounded backoff in 4.4.

## Observability and logs (2026-09-21)

Workers Logs is enabled in `wrangler.jsonc` with `invocation_logs` and
`persist`, so the dashboard keeps both request logs and the structured events
this Worker writes. `src/server/log.ts` owns the format: one JSON line per
event, an `event` name plus counts, identifiers, durations and code-owned
messages, at `info` or `warn` level.

The event vocabulary is deliberately small — `briefing.started`,
`briefing.collected`, `briefing.composed`, `briefing.published`,
`briefing.failed`, `chat.answered`, `chat.failed`, `proposal.created`,
`proposal.failed`, `access.denied` — and each carries a bounded summary rather
than a payload. Article text, model output, prompts, request bodies, and
credentials never reach a log line, because the platform persists them.
`boundedMessage` exists so a caught error becomes a short loggable string while
the richer diagnostic stays in the API response for the owner.

`briefing.collected` is the diagnostic that matters most: it reports the
provider's returned leads, the collection failures with engine names, per-query
status and counts, and every returned lead counted by the outcome collection
gave it. That is what explains a thin edition when discovery itself answered
normally.

## Grounded composition draft (2026-09-19)

The Agent can compose an in-memory briefing draft from an active collection
run. `briefing-composition.ts` is the only module that packs temporary
candidates, recent published coverage, and effective topic settings into one
Workers AI request. The Agent supplies a seven-day, active-topic-only history
of at most 12 compact items; it retains no historical article text for this
comparison.

The call uses the pinned Llama 3.3 70B model once per composition attempt. It
receives candidate IDs, attribution metadata, evidence tier/text, user intent,
exclusions, and effective presentation/source settings. Publisher URLs are
removed before the request. The response may select only those IDs and returns
bounded assessment components (`topicFit`, `briefingValue`, and `novelty`),
presentation copy, and an optional supported update reference. Code computes
the aggregate score, and rejects scores below 70, repeated candidates,
unsupported updates, and groups whose effective topic profiles differ.

Rejection is now per selection and disclosed: an item that contradicts the
request or the supplied candidates is discarded while the rest of the draft
publishes, and the edition carries one `composition-rejected` limitation naming
the reason in plain language. Only unparseable model output, an empty candidate
set, or a draft with no usable story fails the run, and that failure message
names the discards. A model that returns more items than the story limit now has
its lowest-relevance surplus dropped with a `story-budget` limitation instead of
losing the edition. It then
derives topic IDs, dates, source URLs, publishers, citations, completeness, and
provenance from trusted stored inputs.

Evidence is capped at 2,500 characters per candidate and 36,000 characters
combined with prior coverage; prior summaries are capped at 500 characters.
Description-only items receive a visible limitation. These deterministic bounds
limit request size; usage is monitored in the Cloudflare Workers AI dashboard,
with no application telemetry. Composition deliberately does not publish a
briefing or expose a generation route. Workflow orchestration and atomic
publication remain the next slice.

## Durable grounded chat (2026-09-20)

`PersonalBriefingAgent` remains the sole durable owner for both briefing and
chat capabilities. `AIChatAgent` supplies the WebSocket request/recovery
transport, while application-visible `chat_sessions` and `chat_messages` rows
provide durable product history. A session can be created only for an owned,
published briefing run and its existing story; it stores the immutable briefing
date and story headline so it remains browsable after the briefing is older.

Chat model context is built from the session's selected story and only that
session's most recent 12 stored turns. A story summary, stored update note,
code-owned citations, and the bounded extract retained for each cited source are
the complete evidence boundary; the extract carries its tier and retrieval time,
and the prompt requires the model to disclose that it may be incomplete. The
browser renders citations independently, and code adds `[S1]` when a model
response omits a source label. The session APIs are same-origin and `no-store`:
list/create, read messages, and permanent owner-scoped delete. Live publisher
evidence refresh and a richer cross-story briefing conversation remain deferred.

## Discovery feasibility result

Google News RSS returned candidates for the initial AI, world-news, and
Liverpool topics. Its encoded item links first redirect to another Google News
URL, then return a large Google HTML page rather than a publisher URL, which the
earlier feasibility code reported as unavailable evidence.

## Google News publisher-link decoding (2026-09-20)

`discovery/google-news-decoder.ts` implements the protocol the feasibility
scripts verified: read the article page's `data-n-a-sg` and `data-n-a-ts`
values, post them with the opaque ID to Google's `batchexecute` endpoint, and
validate the returned external URL. Collection decodes before deduplication, so
dedupe, blocked-source checks, and evidence all use the publisher URL, and the
decoded lead keeps its Google link as `discoveryUrl`. A lead the run-wide decode
budget cannot resolve stays in the diagnostic trace as `decode-failed`.

The protocol is undocumented and can change, rate-limit, or challenge automated
requests without notice, so the adapter is bounded rather than trusted: two
requests per decode, a 1 MB page bound, no retries, and no CAPTCHA workarounds. A
decoded link is still only a lead — publisher access decides whether evidence
retrieval succeeds.

Channel selection spans both channels. `providerCalls` adds the decoded Google
News channel to every run, includes the private SearXNG channel when configured,
and keeps GDELT only when SearXNG is absent. `briefing-workflow.ts` always
configures SearXNG (local `SEARXNG_BASE_URL` or the private Container), so a
normal generate-briefing run collects from SearXNG and the decoded Google News
RSS channel together. The channels are independent: on 2026-09-20 every SearXNG
query reported `partial` (Bing connection errors and Google News CAPTCHA) while
all six Google News RSS queries returned results.

## Defaults

Initial interests are AI, major world/geopolitical news, Premier League, and
Liverpool FC. A daily five-minute briefing is due at 08:00 Asia/Kolkata. It
returns 8–10 strong stories, avoids padding weak sections, and only resurfaces
material updates with an explanation of what changed.

Partial failures publish an explicitly incomplete briefing. A complete failure
preserves the prior dated briefing. Briefings and conversations persist until
deleted; duplicate-detection data expires after 90 days.

## Cost controls

Workers AI composition uses a pinned Llama 3.3 70B model with bounded input and
output. Collection caps queries, retrievals, and retries; Workers AI dashboard
measurements track usage rather than application-side telemetry. The target is
below USD 10–20/month for a single user. Email, push, and broad web browsing are
deferred.

## Private SearXNG Container (2026-09-19)

SearXNG runs as one private Cloudflare Container, managed by its own Durable
Object binding (`SEARXNG`). The Worker resolves the stable `briefing-search`
instance through `getContainer` and forwards only internal `/search` requests
to port 8080; Cloudflare does not publish a route to the SearXNG process. It
sleeps after ten idle minutes and enables outbound internet access because its
configured engines must contact upstream search services. The Worker collection
budget bounds that use. Durable Object-managed Container sizing is currently
platform-controlled, so the initial deployment must measure its actual usage.

`SEARXNG_SECRET` is a Cloudflare Worker secret and is injected only when the
container starts. It is never committed. The container image copies the same
pinned SearXNG image and `settings.yml` used by loopback-only local Compose,
which keeps local content-quality checks representative of the deployed search
configuration. Container disk/cache is not application memory; durable app
state continues to live in the personal Agent's SQLite database.

The provider is now available to bounded collection as the only channel when
this binding is supplied by the generation Workflow. For local development,
the same Workflow uses the loopback `SEARXNG_BASE_URL` binding when configured;
the private Container remains the deployed path. Google News RSS and GDELT were
retired with the SearXNG-only decision. The bounded scheduler rotates topics and providers; see
[DISC-07](data-pipeline.md#9-improvement-backlog).

## Local inspection integration

The React content lab calls `GET /api/inspection/search`, then explicitly
requests one candidate through `POST /api/inspection/evidence`. Search does
not automatically fetch publishers. Shared Zod contracts validate both edges.
The SearXNG provider is the only implementation in `src/server/discovery`.
Requests, response bytes, candidate counts, and extraction lengths are bounded.
Partial engine failures remain visible alongside successful results.

Diagnostic routes require `INSPECTION_ENABLED=true` and reject cross-origin
browser requests; leave them disabled in deployment. These controls are local
development safeguards, not the planned Cloudflare Access authentication.
No app data is persisted. DNS-aware destination restrictions and robust
readable-body extraction are still required before production retrieval.

## Today and immutable editions

Today and Archive share one reading component. Immutable briefings optionally
carry snapshotted topic names; older payloads retain compatibility through readable
ID fallbacks. Archive detail reads are owner-scoped by run UUID. Today remains an
exact server-timezone date lookup, with an explicitly dated prior-edition link.

The browser recovers the latest durable run and polls sequentially, including a
successful edition read before declaring publication complete. Terminal Workflow
states close stranded reservations; abandoned reservations expire after 30 minutes.
Late publication is rejected once a run is failed. Collection and composition have
10/3-minute step timeouts with zero automatic retries. Failure marking and atomic
publication may retry idempotently. No provider/model call is replayed by recovery.

Collection rotates per-topic jobs through configured SearXNG and rotates
retained candidates for article retrieval. Freshness is an inclusive two-day
application-side check — a one-day target plus the same one-day buffer the search
ranges carry — against the fixed run clock. For an otherwise eligible
undated result, a bounded publisher fetch can recover a date from JSON-LD,
recognized metadata, or a semantic time element; the resulting retrieval is
reused as evidence. Unknown/future dates remain ineligible. Search-reported and
publisher-reported provenance are retained separately; neither proves relevance
or publisher quality (DISC-03). Reader disclosures are deduplicated, while run
diagnostics stay intact.

## Retained collection metadata

Migration 7 separates compact `collection_diagnostics` on a run from temporary
`briefing_candidates` evidence. Completed collection stores normalized discovery
occurrences before filtering, including query identity and counts, then annotates
eligibility, candidate/retrieval budget, and evidence outcomes. Terminal publication
and failure continue deleting article text, but retain this bounded metadata.
Each SearXNG occurrence also retains its contributing engine names, allowing
quality evaluation to distinguish engine-specific date and evidence outcomes.
Publication inclusion is derived from that run's immutable citation URLs; a run
without publication returns null selection rather than implying model rejection.

`GET /api/briefings/runs/:runId/diagnostics` is owner-scoped, no-store, and requires
`PREFERENCES_DIAGNOSTICS_ENABLED=true`. It is separate from product status polling.
Old records return null diagnostics. Interrupted collection before its durable
store has no trace; diagnostic retention/deletion is tracked under STORE-01.
