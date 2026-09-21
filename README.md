# Personal Intelligence Briefing

A single-user Cloudflare app that collects news for natural-language topic
preferences, produces cited briefings, and supports saved follow-up conversations.
The current submission scope uses manual generation; daily scheduling is deferred.

## What works

- Independent topic add/edit/pause/delete, global reading and summary preferences,
  and model-proposed topic changes that require explicit review and application.
- Bounded SearXNG discovery, publisher evidence retrieval, cited briefing
  composition, immutable editions, and an archive. Multiple SearXNG engines
  provide redundancy. Engine and publisher failures remain visible; useful
  results can produce an explicitly incomplete edition.
- Story-scoped saved chat with retained evidence, the latest 12 messages as model
  history, and the latest 200 messages displayed. Conversations can be deleted.
- Cloudflare Access identity verification and owner-scoped HTTP/Agent routing.
  The app intentionally shares one dataset among all admitted identities.

Google News RSS and GDELT are retired: their adapters, the Google publisher-link
decoder, and their verification scripts were removed, and the local feasibility
probe now exercises SearXNG alone. A failed SearXNG service cannot silently
switch the briefing to another provider. On complete generation failure,
existing editions remain stored.

## Stack

React, TypeScript, Vite and Hono run on Workers Static Assets. The personal Agent
owns SQLite persistence in a Durable Object; a Workflow performs collection,
composition and publication. Workers AI supplies the model. Production SearXNG
is configured to run in a private Cloudflare Container accessed only through a
Worker binding; this restored Container path has not yet been deployed.
Local Docker uses the same pinned image and settings.

## Local setup

Requires Node 24.x, npm 11+, Docker, and a Cloudflare account for Workers AI.
Workers AI is remote even during local development and consumes account usage.

```sh
npm ci
cp .dev.vars.example .dev.vars
npm run searxng:start
npx wrangler login
npm run dev
```

Local variables enable inspection and the local owner, set the loopback SearXNG
URL, and blank the production Access values. Keep `.dev.vars` and the generated
`infra/searxng/.env` out of Git. Local app state lives under `.wrangler`.

If the remote AI proxy targets an Access-protected deployment, noninteractive
startup also requires `CLOUDFLARE_ACCESS_CLIENT_ID` and
`CLOUDFLARE_ACCESS_CLIENT_SECRET` in the process environment. Obtain them from an
authorized Access service token; never commit their values. See
[deployment guidance](docs/deployment.md) for the account setup.

## Reviewer walkthrough

1. Open Topics and save the initial preferences, or customize topics first.
2. Optionally ask for a topic change, review the proposal, and apply it.
3. On Today, generate a briefing and wait for its terminal status.
4. Inspect citations and any incomplete-coverage notice; open Archive to revisit
   an edition.
5. Open Chat, select a story, start a conversation, and ask a follow-up. Reload to
   verify persistence. Failed requests show an error so the question can be retried.

Content lab is a local inspection tool. `/api/inspection/*` and
`/api/feasibility/*` require the inspection flag; feasibility additionally requires
identity. Deployment leaves diagnostic flags unset. Agent routes validate the
personal-briefing binding and resolved owner for every suffix and reject foreign
origins, including WebSocket handshakes.

## Validation

The current working tree passes the complete `npm run check` gate — formatting,
lint, strict type checks, 203 tests and a production build — on Node 24, plus
live local Worker checks of the diagnostic and Agent routing boundaries. Verifying
the suite from a relocated checkout remains TEST-01. See the
[implementation plan](docs/implementation-plan.md) for the exact evidence.

```sh
npm run check
npm run verify:searxng-evidence
npm run evaluate:briefing-run
```

`check` runs formatting, lint, strict TypeScript checks, tests and production
build. The live evidence/evaluation scripts require their configured local or
hosted services; unlike fixture tests, results depend on upstream availability.
Do not treat passing fixtures as proof that every publisher or search engine is
reachable from Cloudflare's egress.

## Deployment

Deployment is a separately reviewed action. The Container needs a Workers plan
that supports Containers, Docker for image builds, and a Cloudflare secret named
`SEARXNG_SECRET`. Do not expose a public SearXNG route. Review the complete
[deployment procedure](docs/deployment.md) before publishing.

The [implementation plan](docs/implementation-plan.md) records validation and
increment status. All actionable limitations and follow-ups are maintained only
in the [improvement backlog](docs/data-pipeline.md#9-improvement-backlog), including
hosted verification (DISC-10), retention (STORE-01), older transcript pagination
(CHAT-02), runtime test coverage (EVAL-02), and measured cost (COST-01).
