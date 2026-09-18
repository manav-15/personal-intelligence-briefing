# Personal Intelligence Briefing

A single-user daily briefing app built on Cloudflare Workers. It will discover
news from user-defined topics, retrieve bounded evidence, and produce concise,
cited briefings with grounded follow-up chat.

## Current status

See the maintained [implementation plan](docs/implementation-plan.md) for
milestone status, acceptance criteria, retained TODOs, and the next increment.

The app now has a singleton `PersonalBriefingAgent` backed by Durable Object
SQLite. It stores one versioned preferences document and supports atomic,
revision-checked replacement. The local-only `GET`/`PUT /api/preferences`
diagnostic needs `PREFERENCES_DIAGNOSTICS_ENABLED=true`; it is not a production
settings API and remains disabled unless explicitly configured.

With the local diagnostic enabled, Topics supports add, edit, pause, resume,
and delete. Memory & settings saves global schedule, reading budget, summary,
source, and exclusion defaults. These screens are a local development surface;
Cloudflare Access must protect the production settings interface later.

Increment 1 establishes the deployable React and Worker foundation. The root
page now provides a local content inspection screen and `GET /api/health` reports the
Worker status. Durable Object persistence, AI, scheduling, and Cloudflare Access
arrive in later reviewed increments.

Increment 2 adds Google News RSS and GDELT discovery feasibility. Test GDELT
locally at `/api/feasibility/discovery?provider=gdelt&q=Liverpool&limit=3`;
omit `provider` to use Google News. Providers are separate files in
`src/server/discovery`. GDELT returns direct publisher links, with explicit
rate-limit failures and bounded article retrieval. Discovery success does not
guarantee that publishers allow article retrieval.

## Requirements

- Node 24.x
- npm 11+
- Docker Desktop running for local SearXNG
- A Cloudflare account is needed only for deployment

## Local development

```sh
npm ci
cp .dev.vars.example .dev.vars
npm run searxng:start
npm run dev
```

Visit the local URL printed by Vite. The app checks the Worker health endpoint
on load.

Hono owns the Worker HTTP layer. `src/server/index.ts` composes health,
preferences, inspection, and feasibility routes from `src/server/routes/` and
exports the Durable Object class. No additional local service or deployment
binding is required for Hono. Workers Static Assets still serves the React app;
`/api` and `/api/*` always reach the Worker and return JSON errors for unknown
routes. Unsupported methods, including HEAD and OPTIONS, return 405 with
`Allow` after the route's diagnostic/origin guards. HEAD has no response body.
Vite CORS interception is disabled so local OPTIONS checks reach these handlers.

Search keywords or use the three topic shortcuts. Inspect source links, search
descriptions, engine failures, reported dates, and on-demand article text.
Evidence is labelled article text, description only, or headline only. This is
a quality inspection tool: it does not interpret natural language, summarize,
save topics, or persist results yet.

The default time range is **Any time** for inspection. Last-day searches can
return no results; engines may still supply old or undated leads. Warnings do
not constitute a publication freshness filter. Extraction can include footer
and related-story text, so review it before trusting future summaries.

Filtered searches now query all three engines and apply concrete date ranges
locally: previous 24 hours, 31 days, or 365 days. Undated/future leads are
excluded; the UI shows range boundaries and excluded counts. Dates come from
search metadata, and filtering only covers the returned candidate set.

`INSPECTION_ENABLED=true` opts into local diagnostic routes; keep it unset in
deployment. `.dev.vars` is ignored. SearXNG stays on loopback port 8080. Stop it
with `npm run searxng:stop` when finished. The evidence endpoint requires a
same-origin JSON POST; production authentication and DNS-aware outbound
restrictions remain future work.

## Quality checks

```sh
npm run check
```

This runs formatting, linting, TypeScript checks, unit tests, and a production
build. CI will run the same command.

## Discovery-link experiments

For local SearXNG and publisher-evidence verification, see
[the local setup guide](infra/searxng/README.md). Run `npm run searxng:start`
with Docker running, then `npm run verify:searxng-evidence`.

Before choosing the Increment 2 discovery provider, run the read-only
experiments described in [discovery-link-verification.md](docs/discovery-link-verification.md).
They test Google News RSS decoding, GDELT direct URLs, and a SearXNG JSON
endpoint without changing Worker code or local application data.

## Deployment

Deployment is deliberately deferred until the Agent, Durable Object, Workflow,
and Access bindings exist. The intended command is `npx wrangler deploy`; the
final setup guide will document the required bindings, Access policy, and
secrets.

## Evidence limitations and planned improvements

See [the detailed data pipeline and improvement backlog](docs/data-pipeline.md)
for natural-language parsing, planned storage, current discovery/evidence
parsing, implemented inspection fallback qualification, and planned briefing policy.

Configuration will use independently added topics, with global briefing
defaults. See [the next iteration plan](docs/next-iteration.md) for local
integration results and following persisted topic management and scoped prompts.

Google News results are discovery leads, not sufficient evidence for detailed
summaries. The feasibility check confirmed that Google's encoded RSS links do
not directly resolve to publisher URLs: a dedicated resolver or alternate
provider is required before bounded publisher-page retrieval can be enabled.
The app retains citations, metadata, and summary provenance instead of full
articles. It must disclose when a chat answer only has a feed excerpt or cannot
retrieve an article.

Planned extensions include private SearXNG hosting, stronger readable-content
extraction, source-quality controls, and evidence refreshes for deeper chat.
They are intentionally not part of the first deployable slice.
