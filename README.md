# Personal Intelligence Briefing

A single-user daily briefing app built on Cloudflare Workers. It will discover
news from user-defined topics, retrieve bounded evidence, and produce concise,
cited briefings with grounded follow-up chat.

## Current status

Increment 1 establishes the deployable React and Worker foundation. The root
page is intentionally a small placeholder and `GET /api/health` reports the
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
- A Cloudflare account is needed only for deployment

## Local development

```sh
npm ci
npm run dev
```

Visit the local URL printed by Vite. The app checks the Worker health endpoint
on load.

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
parsing, and the proposed description-only fallback policy.

Configuration will use independently added topics, with global briefing
defaults. See [the next iteration plan](docs/next-iteration.md) for local
SearXNG integration followed by persisted topic management and scoped prompts.

Google News results are discovery leads, not sufficient evidence for detailed
summaries. The feasibility check confirmed that Google's encoded RSS links do
not directly resolve to publisher URLs: a dedicated resolver or alternate
provider is required before bounded publisher-page retrieval can be enabled.
The app retains citations, metadata, and summary provenance instead of full
articles. It must disclose when a chat answer only has a feed excerpt or cannot
retrieve an article.

Planned extensions include a private SearXNG adapter, stronger readable-content
extraction, source-quality controls, and evidence refreshes for deeper chat.
They are intentionally not part of the first deployable slice.
