# Personal Intelligence Briefing

A single-user daily briefing app built on Cloudflare Workers. It will discover
news from user-defined topics, retrieve bounded evidence, and produce concise,
cited briefings with grounded follow-up chat.

## Current status

See the maintained [implementation plan](docs/implementation-plan.md) for
milestone status and acceptance criteria, and the
[single improvement backlog](docs/data-pipeline.md#9-improvement-backlog) for
all open follow-ups.

The app now has a singleton `PersonalBriefingAgent` backed by Durable Object
SQLite. It stores one versioned preferences document, pending/applied/discarded
topic proposals, and the foundation for immutable briefing publication records.
Today and Archive currently read those publication records and show an empty
state until manual briefing generation is added. The Topics screen can ask Llama
3.3 70B to propose one new or edited topic; the user reviews a before/after card
and explicitly applies or discards it. The local-only `/api/preferences` and
`/api/briefings` diagnostics need
`PREFERENCES_DIAGNOSTICS_ENABLED=true`; it is not a production settings API and
remains disabled unless explicitly configured.

With the local diagnostic enabled, Topics supports add, edit, pause, resume,
and delete. Memory & settings saves global schedule, reading budget, summary,
source, and exclusion defaults. These screens are a local development surface;
Cloudflare Access must protect the production settings interface later.

The root page provides a local content inspection screen and `GET /api/health`
reports the Worker status. Scheduling and Cloudflare Access arrive in later
reviewed increments.

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
- A Cloudflare account is needed for Workers AI local inference and deployment

## Cloudflare account and Workers AI authentication

Create or use a Cloudflare account before testing assisted topic proposals.
Workers AI has no local model simulator: its `AI` binding connects to Cloudflare
remotely, including while the Worker code itself runs locally. Local inference
therefore consumes Workers AI usage from the selected account.

For interactive development, authenticate Wrangler once in a terminal:

```sh
npx wrangler login
npm run dev
```

Wrangler opens a browser login flow. Use an account that has access to the
target Cloudflare account and Workers AI. If Cloudflare asks you to accept the
Llama 3.3 model terms on the first request, complete that account-level step
before retrying the proposal.

The first remote Workers AI development session also requires an account-level
`workers.dev` subdomain. If Wrangler shows the subdomain-registration message,
open its onboarding link, choose an unused subdomain, then run `npm run dev`
again. This enables Cloudflare's remote binding proxy for AI; it does not deploy
this app publicly because this project keeps `workers_dev` disabled and has no
production route configured yet. Do not press the offered local-only mode when
testing topic proposals: it disables remote bindings, and Workers AI has no
local model simulator.

For non-interactive shells and CI, create a least-privileged Cloudflare API
token for the target account, export it in the process that runs Wrangler, and
keep it out of `.dev.vars`, source files, and Git:

```sh
export CLOUDFLARE_API_TOKEN="your-token"
npm run dev
```

Use Cloudflare's API-token creation flow to grant only the permissions needed
for the Wrangler commands you run; verify authentication with
`npx wrangler whoami`. Store CI tokens in the CI provider's secret store. The
Workers AI dashboard, not this app, shows neuron usage.

## Local development

```sh
npm ci
cp .dev.vars.example .dev.vars
npm run searxng:start
npm run dev
```

The Workers AI binding uses your Cloudflare account in local development. The
authentication steps above are required before testing topic proposals. Neuron
usage is visible in the Cloudflare Workers AI dashboard; the application does
not collect usage telemetry.

Visit the local URL printed by Vite. The app checks the Worker health endpoint
on load.

Hono owns the Worker HTTP layer. `src/server/index.ts` composes health,
preferences, briefings, inspection, and feasibility routes from `src/server/routes/` and
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
and Access bindings exist. The Worker configuration already declares a private
SearXNG Cloudflare Container: one Durable Object-managed instance using the
same pinned image and settings as local Docker. It has no public route; the
Worker reaches it through its `SEARXNG` binding. Before the first deployment,
set its runtime secret without putting it in source control:

```sh
npx wrangler secret put SEARXNG_SECRET
```

The intended deployment command is `npx wrangler deploy`; the final setup guide
will document Access, Workflow, and remaining production bindings. `npm run dev`
does not deploy cloud resources. Local Docker remains the supported way to
inspect search and article evidence.

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

Open work, including stronger readable-content extraction, source-quality
controls, fair provider scheduling, and evidence refreshes for deeper chat, is
tracked in the [improvement backlog](docs/data-pipeline.md#9-improvement-backlog).
