# Project instructions

## Product and scope

Build a single-user Personal Intelligence Briefing Agent for Cloudflare's AI
application assignment. The product collects news based on natural-language
preferences, produces a cited daily briefing, and supports grounded follow-up
chat.

- Initial interests: AI, major world/geopolitical news, Premier League, and
  Liverpool FC.
- Default schedule: daily at 08:00 Asia/Kolkata.
- Default briefing: about five minutes and 8–10 strong stories. Do not pad a
  weak topic section.
- Resurface only substantial updates and explain what changed.
- Users review and explicitly apply proposed preference changes.
- Summary style, depth, audience, and emphasis are user-controlled through
  natural-language prompts. Topic preferences may override global preferences.
- Publish an explicitly incomplete briefing on partial collection failure. On a
  complete failure, retain the prior dated briefing.
- Keep briefings and conversations until deleted; delete deduplication memory
  after 90 days.

Do not add email, push notifications, general-purpose web browsing, or SearXNG
hosting unless the user explicitly expands scope.

## Architecture

Use React + TypeScript + Vite with Cloudflare Workers Static Assets. The
personal Agent owns preferences, chat, briefing history, covered stories, and
run state in Durable Object SQLite. A Workflow owns briefing generation.

Use Google News RSS as the first discovery provider behind a replaceable
adapter. Discovery links are not enough evidence for detailed summaries: use
bounded article retrieval, store citations/metadata/provenance rather than full
article copies, and disclose unavailable evidence in chat.

Keep modules deep with small interfaces. Use an adapter only when there are two
real implementations. Avoid generic repositories, DI frameworks, plugin
registries, and ORMs. Validate all browser, provider, and model input at its
runtime edge.

## Engineering rules

- Keep changes small and reviewable. Complete one planned increment, report the
  diff and validation, then wait for user review before the next increment.
- Preserve the single `npm run check` gate: format, lint, typecheck, tests, and
  production build must pass before requesting review.
- Use strict TypeScript. Add concise JSDoc comments to public entrypoints,
  exported functions, methods, classes, schemas, and types.
- Pin dependencies and retain `package-lock.json`. Target Node 24.x.
- Do not commit credentials, local Worker state, generated output, or caches.
- Maintain README deployment/setup guidance, architecture decisions, and
  `PROMPTS.md`.
- Prompt history is required. Before completing every implementation increment,
  append the user request and any material AI coding prompt to `PROMPTS.md`.
  Each entry must state the date, the increment or change it informed, the
  prompt text (verbatim where practical), and a short outcome. Never recreate
  prompt history retrospectively or omit prompts because they were delivered in
  conversation rather than a tool.

## Cost target

Keep the personal deployment below USD 10–20/month by capping search queries,
article retrieval, model input/output, and retries. Track usage before making
cost guarantees.
