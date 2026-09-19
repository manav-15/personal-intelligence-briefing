# Architecture decisions

## Initial shape

One Worker serves the React assets and first-party routes. A single personal
Agent will later own persistent preferences, conversations, briefings, covered
stories, and run state in Durable Object SQLite. A Workflow will perform the
daily briefing pipeline.

## HTTP composition (2026-09-18)

Pinned Hono 4.13.8 replaces manual Worker dispatch. `src/server/index.ts`
composes the route groups in `src/server/routes/` and preserves the
`PersonalBriefingAgent` export. Hono owns HTTP validation and responses; discovery,
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
- Feasibility: method → provider validation → `no-store` → bounded discovery and
  evidence. Its existing endpoint has no diagnostic flag; this refactor does not
  broaden or restrict it. Production authentication remains deferred.

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
the aggregate score, rejects scores below 70, invalid IDs, repeated candidates,
unsupported updates, and groups whose effective topic profiles differ. It then
derives topic IDs, dates, source URLs, publishers, citations, completeness, and
provenance from trusted stored inputs.

Evidence is capped at 2,500 characters per candidate and 36,000 characters
combined with prior coverage; prior summaries are capped at 500 characters.
Description-only items receive a visible limitation. These deterministic bounds
limit request size; usage is monitored in the Cloudflare Workers AI dashboard,
with no application telemetry. Composition deliberately does not publish a
briefing or expose a generation route. Workflow orchestration and atomic
publication remain the next slice.

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

The provider is now available to bounded collection as the first channel when
this binding is supplied by the later generation Workflow. Google News RSS and
GDELT remain bounded fallbacks. A fair scheduler is still required so one topic
or provider cannot consume the complete run budget; see
[DISC-07](data-pipeline.md#9-improvement-backlog).

## Local inspection integration

The React content lab calls `GET /api/inspection/search`, then explicitly
requests one candidate through `POST /api/inspection/evidence`. Search does
not automatically fetch publishers. Shared Zod contracts validate both edges.
The SearXNG provider is a separate file alongside Google News and GDELT.
Requests, response bytes, candidate counts, and extraction lengths are bounded.
Partial engine failures remain visible alongside successful results.

Diagnostic routes require `INSPECTION_ENABLED=true` and reject cross-origin
browser requests; leave them disabled in deployment. These controls are local
development safeguards, not the planned Cloudflare Access authentication.
No app data is persisted. DNS-aware destination restrictions and robust
readable-body extraction are still required before production retrieval.
