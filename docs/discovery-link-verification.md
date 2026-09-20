# Discovery link verification

These scripts are experiments, not application code. They provide a reproducible
way to decide whether a discovery service gives a canonical publisher URL that
the evidence module can retrieve.

The Google News sequence documented below is implemented in the Worker as
`src/server/discovery/google-news-decoder.ts` under backlog item DISC-08; this
script remains the standalone reproducibility check.

Run them with Node 24:

```sh
npm run verify:google-links -- "artificial intelligence" 1
npm run verify:search-links -- "Premier League Liverpool"
```

`verify:google-links` makes at most one Google News RSS query and processes one
to five results. `verify:search-links` makes one GDELT request and one request
to a configurable SearXNG public instance. Set `SEARXNG_URL` to test a specific
instance. These commands only read remote resources and print JSON; they do not
write application data.

## Google News RSS

The RSS API supplies a Google-owned URL such as
`https://news.google.com/rss/articles/<opaque-id>?oc=5`, not the article URL.
The script's verified sequence is:

1. Request the RSS search endpoint and read the item's opaque ID from its link.
2. Fetch `https://news.google.com/rss/articles/<opaque-id>` and extract the
   `data-n-a-sg` signature and `data-n-a-ts` timestamp from the Google page.
3. Send the ID, signature, and timestamp to Google's `batchexecute` endpoint.
4. Parse the nested response for the publisher URL.
5. Request that URL with manual redirects to record the eventual location,
   HTTP status, and content type without downloading the article body.

On 2026-09-17, this returned the canonical Economist URL for the RSS item
“Artificial intelligence now beats some of the best human forecasters.” The
publisher request then returned HTTP 403. This establishes that decoder success
does not establish evidence-fetch success.

Google does not document this decoder as a public API. It may change, rate
limit, or challenge automated requests without notice. The steps are therefore
repeatable experiments, but not a deterministic or supportable product
contract. Do not build the planned Worker implementation around it without a
reviewed fallback.

Google's documented News sitemap format instead has publishers submit their
own canonical article `<loc>` URLs; it does not document decoding a consumer
RSS item's opaque ID. See [Google News sitemaps](https://developers.google.com/search/docs/crawling-indexing/sitemaps/news-sitemap).

### Measured Google-side behaviour (2026-09-20)

What Google enforces, from one session on a single residential IP:

- **No quota or rate limit was encountered.** 310 sequential article-page
  requests (roughly 176 MB) completed in 87 seconds with every response HTTP 200
  — no 429, no `Retry-After` header, and no challenge page. A further 40
  page-request cycles behaved the same. The page endpoint's observed latency was
  p50 ≈ 210–250 ms, p95 ≈ 305 ms.
- **Page weight is the practical cost.** Each article page was 259 KB–595 KB
  (median ≈ 582 KB) of HTML; the `batchexecute` response is only ≈170–200 bytes.
  A decode therefore costs roughly 580 KB and two requests, and a run's byte cost
  is set by its decode budget, not by Google.
- **The request envelope is exact.** `f.req` must be
  `[[[ "Fbv4je", "<request JSON>" ]]]` — one nesting level more than the
  outermost operation list suggests. Any mismatch (including an ID left carrying
  `?oc=5`) is rejected as HTTP 400 with an `er` row and no explanation, and the
  page request still succeeds, so the failure looks like a Google-side block
  even though the payload is at fault. Decode failures on this endpoint are
  therefore silent by design and must be attributed locally.
- **Policy, not quota:** `news.google.com/robots.txt` serves `User-agent: *` with
  `Disallow: /` and an allowlist that does not include `/rss/...`. The Worker
  fetches on behalf of one user rather than crawling, but this is a compliance
  consideration worth stating, not a technical limit.

Absence of throttling in one session is not a guarantee. Google can rate-limit or
change the protocol without notice; the Worker therefore bounds decodes, sends no
retries, and reports each unresolved lead rather than treating a failure as a
temporary glitch.

## GDELT DOC 2.0

The public GDELT article-list endpoint accepts a keyword query and returns
article records with an `articles[].url` field. The verified sequence is:

1. Request `https://api.gdeltproject.org/api/v2/doc/doc` with `mode=artlist`,
   `format=json`, a bounded `maxrecords`, and a bounded `timespan`.
2. Treat each returned `articles[].url` as the canonical publisher candidate.
3. Apply the normal evidence fetch, redirect validation, extraction, and
   citation checks to that URL.

The initial 2026-09-17 request for `artificial intelligence` returned direct
publisher URLs, including an AP story hosted by `stardem.com`. Repeated probes
later received HTTP 429, which the script reports. URL shape is deterministic
within a successful response; availability, indexing freshness, language, and
ranking quality are not. Respect rate limits and make failures recoverable.

GDELT documents the endpoint and response examples at [GDELT DOC 2.0 API](https://blog.gdeltproject.org/gdelt-doc-2-0-api-debuts/).

## SearXNG

SearXNG's documented search endpoint supports
`GET /search?q=<query>&categories=news&format=json`. When a controlled instance
enables JSON, use `results[].url` as the publisher candidate, then use the
normal evidence-fetch sequence.

The tested public instance, `https://searx.be`, returned HTTP 200 HTML browser
verification instead of JSON on 2026-09-17. A successful status code alone is
not sufficient: the provider adapter must require an `application/json`
content type and a result URL. A self-hosted instance can make its endpoint
configuration controllable, but its upstream search engines may still block,
rate-limit, or change result quality. SearXNG hosting remains outside the
current product scope.

See the [SearXNG search API documentation](https://docs.searxng.org/dev/search_api.html), which notes that JSON output must be enabled by the instance.

## Decision implication

GDELT gives a direct publisher URL without an undocumented decoder and needs
strict language/source filters and a rate-limit policy; it stays off normal runs
while live requests return 429. Google News RSS has a bounded Worker decoder and
runs alongside the private SearXNG instance, so a CAPTCHA in SearXNG's own
`google news` engine no longer removes all discovery. Its protocol is still
undocumented, so a challenge or an article page larger than the byte bound fails
closed and must disclose the unresolved lead rather than substitute a weaker
claim. SearXNG remains the primary search channel and still needs a controlled
deployment before it can be treated as a dependable provider.
