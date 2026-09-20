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
rate-limit failures and bounded article retrieval. A bounded Google News
publisher-link decoder resolves RSS items to publisher URLs and discloses leads
its budget cannot resolve; normal briefing runs query the SearXNG channel and
this Google News channel together, so a SearXNG engine failure does not remove
all discovery. Discovery success does not guarantee that publishers allow
article retrieval.

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

Filtered inspection searches send SearXNG `time_range=day`, `month`, or `year`
and then apply concrete server-side date ranges with a one-day buffer: previous
2 days, 32 days, or 366 days. Undated/future leads are excluded; the UI shows range boundaries
and excluded counts. Daily briefing collection deliberately queries configured
SearXNG news engines without that parameter and applies the same server-side
freshness gate, avoiding a Bing-only path when other engines do not implement
upstream time filtering.

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

The Worker is ready to host on the Workers **Free** plan. It stores preferences,
briefings, chat, and retained evidence in Durable Object SQLite, generates
through a Workflow, and deploys no container: SearXNG is off, so discovery runs
the decoded Google News RSS channel plus GDELT. `infra/searxng/` remains for
local Docker verification through `SEARXNG_BASE_URL`; re-enabling the hosted
SearXNG path means restoring the container binding and the paid plan.

Every API and Agent request must carry a valid Cloudflare Access JWT. The Worker
verifies it itself (RS256 against the team's JWKS, with the issuer, audience, and
expiry checked) and refuses everything else, so a deployment is safe before its
Access application exists — it simply rejects until `ACCESS_AUD` is configured.
The team domain is already set; the AUD tag is added once the Access application
exists.

Deploy with the repository configuration, validating first:

```sh
npm run build
npx wrangler deploy --dry-run --config wrangler.jsonc
npx wrangler deploy --config wrangler.jsonc
```

`--config wrangler.jsonc` is required: the Vite plugin redirects Wrangler to a
generated `dist/<worker>/wrangler.json` whose relative paths do not all resolve,
so a plain `npx wrangler deploy` fails. Set `workers_dev` to `true` for the free
`workers.dev` address (or add a custom domain route) at deploy time.

Nothing is exposed by default: `workers_dev` and `preview_urls` are both false.
The ordered dashboard and command steps, including the Access setup and the
values each side needs, are in [the deployment guide](docs/deployment.md); the
phased increment is in [`docs/implementation-plan.md`](docs/implementation-plan.md).

## Evidence limitations and planned improvements

See [the detailed data pipeline and improvement backlog](docs/data-pipeline.md)
for natural-language parsing, planned storage, current discovery/evidence
parsing, implemented inspection fallback qualification, and planned briefing policy.

Configuration will use independently added topics, with global briefing
defaults. See [the next iteration plan](docs/next-iteration.md) for local
integration results and following persisted topic management and scoped prompts.

Google News results are discovery leads, not sufficient evidence for detailed
summaries. On the RSS discovery path, collection resolves their encoded links to
publisher URLs through a bounded decoder for undocumented Google endpoints and
keeps the Google link as provenance; leads the budget cannot resolve stay in the
run diagnostic trace and are never fetched. Generate-briefing runs this channel
alongside SearXNG, and each Google query gets its own share of the run's decode
budget.

The app retains citations, metadata, and summary provenance instead of full
articles. It must disclose when a chat answer only has a feed excerpt or cannot
retrieve an article.

Open work, including stronger readable-content extraction, source-quality
controls, fair provider scheduling, and evidence refreshes for deeper chat, is
tracked in the [improvement backlog](docs/data-pipeline.md#9-improvement-backlog).

## Reading and generating briefings locally

Open Today and choose **Generate briefing** (or **Refresh briefing**). Saved
preferences must contain an enabled topic. The previous edition stays readable
while generation runs; reloading or returning to Today restores progress.
Archive opens complete, dated editions and their sources. An incomplete edition
shows its coverage explanation without filling missing topics with weak stories.

The local Worker exposes `/api/briefings/current-run`, `/api/briefings/runs/:runId`,
and `/api/briefings/archive/:runId` alongside Today, archive listing, and generation.
A failed load has a retry action. Abandoned generation reservations expire after
30 minutes; confirmed stopped Workflows reconcile sooner. This does not enable
scheduled generation or deploy the application. Cloudflare Access remains
DEPLOY-02 in the [pipeline backlog](docs/data-pipeline.md#9-improvement-backlog).

For local collection debugging, enable `PREFERENCES_DIAGNOSTICS_ENABLED=true`
and read `/api/briefings/runs/:runId/diagnostics`. New completed collections retain
compact query counts and candidate metadata after publication or failure, without
article/snippet text. The response includes published citation URLs for comparison.
Old runs return null metadata. Leave this diagnostic binding disabled in deployment.

## Asking follow-up questions locally

Open **Chat** after a briefing exists. Select a story, then start a saved
conversation. Each session stores its briefing run, briefing date, and story
identity, so it can be reopened after reload and remains in the Chat library
when its edition becomes historical. The Agent answers only from that saved
briefing item: its summary, stored update note, listed citations, and the bounded
extract of each cited source retained at publication. If no edition exists for
the current local day, Chat opens the newest retained edition. In the question
box, **Enter** sends the question and **⌘Enter** (or **Ctrl+Enter**) starts a
new line, so a longer question can be composed without a mouse.
**Delete conversation** permanently removes that session and its messages.

The retained extract is capped at the extraction limit and older editions have
none, so the model must say when the text cannot support an answer. It does not
retrieve new articles or run broad search. Publisher-evidence refresh is tracked
in the [pipeline backlog](docs/data-pipeline.md#9-improvement-backlog).
