# Local SearXNG feasibility

Requires Docker Desktop (or a compatible Docker engine), Docker Compose, and
Node 24. Start Docker before running these commands from the repository root:

```sh
npm run searxng:start
npm run verify:searxng-evidence
npm run searxng:stop
```

The service listens only on `127.0.0.1:8080`. Open
[local SearXNG](http://localhost:8080) to explore searches. The start command
creates an ignored `infra/searxng/.env` with a generated secret, starts the
container, and waits for HTTP readiness. The pinned official image reports
SearXNG `2026.9.17-274b63b67`.

JSON and HTML formats are enabled. Search uses Bing News, DuckDuckGo News,
Brave News, Google News, and Reuters. Google News here is SearXNG's engine,
which is separate from the application's Google News RSS discovery adapter.
Brave's disabled web engine is retained because its news engine shares the
parent network configuration. This private instance has no limiter or public
bot detection, so it does not need Valkey. The same pinned image and
`settings.yml` are built by the private Cloudflare Container declared in
`wrangler.jsonc`. Local Compose alone supplies the loopback port and cache
volume. The Cloudflare Container has no public route and is called only through
the Worker Durable Object binding.

For logs and service status:

```sh
docker compose -f infra/searxng/compose.yml ps
docker compose -f infra/searxng/compose.yml logs --tail 100
```

After editing settings, restart the service:

```sh
docker compose -f infra/searxng/compose.yml restart
```

## Evidence verification

The standalone script runs our three topics by default. It requires a JSON
search response, then tries up to six publisher links sequentially until it
finds paragraph text. Each response is capped at 500 KB; publisher retrieval
has a 15-second timeout and five redirects. It prints original/final URLs,
engine failures, paragraph counts, and a text sample for manual inspection.
It does not store full articles or application data. No Worker provider was
added in this increment.

To test a single topic or change the cap (maximum ten):

```sh
npm run verify:searxng-evidence -- "Liverpool FC Premier League"
SEARXNG_ARTICLE_LIMIT=3 npm run verify:searxng-evidence -- "artificial intelligence"
```

Exit code zero means each query yielded at least one retrievable paragraph
sample, not that the content is correct, relevant, fresh, or production ready.
The extractor is a paragraph heuristic; inspect the printed sample against the
story title. Publisher blocks, JavaScript-only pages, excessive HTML size, and
upstream errors remain recoverable failures for future app integration.

## Measured results — 2026-09-18

Initial search results numbered 74 for AI, 62 for geopolitics, and 51 for
Liverpool. Across twelve unique publisher targets checked, five returned
article paragraphs matching their titles:

| Topic       | Publisher | Paragraphs | Characters |
| ----------- | --------- | ---------: | ---------: |
| AI          | EWTN News |         21 |      4,214 |
| Geopolitics | WFAE      |         10 |      4,479 |
| Geopolitics | TIME      |         12 |      4,667 |
| Liverpool   | Heavy     |         10 |      2,606 |
| Liverpool   | Khel Now  |         12 |      3,060 |

The Heavy URL followed a 301 to a trailing-slash canonical URL before returning 200. AP, Forbes, and The Athletic returned 403; MSN returned 200 but insufficient
paragraphs; Flashscore exceeded the response bound. Bing News reported a
connection error while DuckDuckGo and Brave supplied candidates. A geopolitics
query surfaced older articles: freshness filtering and better query selection
still need evaluation. This confirms local discovery-to-text feasibility,
not complete daily-news coverage or reliable cloud-hosted operation.

The official [container guide](https://docs.searxng.org/admin/installation-docker.html)
and [search API](https://docs.searxng.org/dev/search_api.html) explain installation
and JSON configuration. Search engines can block our container's outbound IP;
owning the instance does not bypass those restrictions.

The final default verifier run exited zero for all three topics. It retrieved
Miami Herald AI coverage (2,790 characters), WFAE geopolitics coverage (4,479
characters), and Sky Sports Liverpool coverage (1,436 characters). Bing News
recovered and the final searches reported no unresponsive engines. Result
ordering changed between runs; the verifier needed three, two, and five
publisher attempts respectively. WFAE's result was still older coverage,
confirming that evidence availability and daily-news freshness are separate
validation gates.
