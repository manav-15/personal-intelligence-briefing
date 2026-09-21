# Deployment

The current production configuration uses Workers Static Assets, a personal SQLite Durable Object, a
briefing Workflow, Workers AI, and one private SearXNG Container. Generation is
manual. The restored Container configuration has not yet been deployed or
hosted-verified. Deployment remains a separately reviewed action.

## Account prerequisites

Use a Cloudflare account with Workers AI and Container support. Docker must be
available to build the pinned image in `infra/searxng/Dockerfile`. The Container
and local Compose service share that image and `settings.yml`; only local
Compose publishes a loopback port.

Protect the complete app hostname, including `/api/*` and `/agents/*`, with a
Cloudflare Access application. Allow only the owner's identity and explicitly
needed reviewer identities. Admitted identities share one dataset and have write
access; this is not a multi-user or read-only reviewer system.

Configure `ACCESS_TEAM_DOMAIN` and the application's `ACCESS_AUD` in
`wrangler.jsonc`. Its committed values target the current account; another account
must replace them. `ACCESS_ALLOWED_IDENTITIES` may further restrict emails,
subjects or service-token identifiers beyond the Access policy. Preview URLs are
disabled; protect the workers.dev hostname used by the deployment.

The Worker verifies the JWT signature, issuer, audience and expiry. Agent routes
also validate the binding and owner on every subpath, and reject foreign origins.
Static assets and the health endpoint rely on the hostname-level Access policy;
owner data APIs enforce identity in the Worker.

## Private search service

The `SEARXNG` Durable Object binding routes to `SearxngContainer`. The workflow
uses that binding when no local `SEARXNG_BASE_URL` is set. There is no public
SearXNG route, and generic Agent routing rejects the Container binding.

Before the separately approved deployment, set a generated secret through
Wrangler's interactive secret input:

```sh
npx wrangler secret put SEARXNG_SECRET --config wrangler.jsonc
```

Never put the value in source, documentation, command-line arguments, or chat.
Do not set `SEARXNG_BASE_URL` to localhost in production. Leave
`INSPECTION_ENABLED` and `PREFERENCES_DIAGNOSTICS_ENABLED` unset.

SearXNG is the sole briefing discovery provider. Its engine redundancy tolerates
individual failures; it does not guarantee complete coverage. A fully unavailable
search service fails the run without replacing prior editions. The Container
sleeps after ten idle minutes and is capped at one instance; hosted startup and
engine coverage need deployment validation (DISC-10).

## Commands after review

```sh
npm run check
npm run deploy:dry-run
npm run deploy
```

The scripts explicitly pass `--config wrangler.jsonc` so the generated Vite
configuration cannot accidentally change deployment path resolution. A dry run
does not establish successful hosted Container startup or AI inference.

## Post-deploy verification

1. Without a session, the hostname requires Access authentication. Direct owner
   API requests must never return saved data without a valid identity.
2. After sign-in, save preferences and generate an edition from SearXNG. Record
   Container startup, engine failures, usable evidence and publication outcome.
3. Confirm `/api/inspection/search` and `/api/feasibility/discovery` return 404.
4. Confirm foreign Agent owner/binding paths return 404 and a signed-in chat
   connection works through Access.
5. Reopen the saved edition and chat after reload. Verify total collection
   failure preserves existing editions and partial failure remains labelled.

These are verification steps, not a second backlog. Open deployment and quality
work is tracked in `docs/data-pipeline.md` under DISC-10, DEPLOY-01, DEPLOY-02,
STORE-01 and COST-01.

## Local development with Access

The example `.dev.vars` blanks Access values and enables the local owner explicitly.
Remote Workers AI still needs account authentication. When its remote proxy is
behind Access, a noninteractive session needs the process environment variables
`CLOUDFLARE_ACCESS_CLIENT_ID` and `CLOUDFLARE_ACCESS_CLIENT_SECRET` for an authorized
service token. The Access application needs a policy admitting that service token.
Keep credentials out of Git and logs. Interactive login/tunnel requirements depend
on the local Wrangler setup.
