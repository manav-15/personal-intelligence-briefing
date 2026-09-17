# Preference contracts

This is the implementation decision record for slice 3.1. Runtime schemas and
fixtures live in `src/shared/preferences.ts`. They are shared by future browser,
Agent, and model boundaries; they do not create persistence or infer settings.

## Ownership and inheritance

One versioned `Preferences` document owns global defaults and independent
`Topic` records. A topic has a stable ID, enabled flag, user interests and
exclusions, preserved user wording, optional summary/source overrides, and
future provider-neutral search concepts.

Missing overrides inherit global fields. Explicit summary and preferred-source
arrays replace the corresponding global fields. Global exclusions and blocked
sources are always combined with topic restrictions, so a topic cannot loosen a
global safety or editorial restriction. Source URLs must use HTTPS.

`SearchConcept` is a discovery intent (`terms` plus `intent`), not a provider
query. It is distinct from user wording and is compiled into provider-specific
queries later. No model can write queries, SQL, or preferences directly.

## Proposal and application

A future model returns a complete `TopicProposal`: a proposal ID, base
preference revision, original request, add/edit scope, complete proposed topic,
explanation, and unresolved questions. An edit must retain the chosen topic ID.
The proposal has no global preference field, so topic-scoped interpretation
cannot silently change schedule or reading settings.

The later Apply operation will retrieve a stored proposal by ID and check its
base revision against the current revision. The browser will not resubmit a
model-generated patch. Rejected, ambiguous, invalid, or stale proposals change
nothing.

## Future model and relevance decisions

Model choice remains an evaluation decision. Slice 3.5 will compare configured
Workers AI models against deterministic prompts for interpretation quality,
ambiguity, exclusions, latency, and measured usage. This contract records model
provenance later but makes no inference call now.

Relevance belongs to briefing generation, not preferences. Code will enforce
enabled topics, blocked sources, deterministic exclusions, freshness policy,
and exact duplicates. A model may assess semantic fit and explain it. Ranking
will combine semantic fit, freshness, evidence quality, and source preference;
weights will be evaluated against reviewed examples rather than set here.
