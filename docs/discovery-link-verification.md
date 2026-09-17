# Discovery link verification

These scripts are experiments, not Worker code. They provide a reproducible way
to decide whether a discovery service gives a canonical publisher URL that the
future evidence module can retrieve.

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

GDELT is the only currently tested source that gives a direct publisher URL
without an undocumented decoder. It needs strict language/source filters and a
rate-limit policy. Google News RSS remains useful as discovery, but its current
decoder is an evaluated fallback only. SearXNG needs a controlled deployment
before it can be treated as a dependable provider.
