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
- Configure topics independently: add/edit/pause/delete topics without
  replacing other topics. Keep schedule and total reading budget global;
  topic summary/source settings inherit defaults and may override them.
  Introduce manual topic management before topic-specific natural-language
  interpretation; an all-in-one briefing prompt is optional future work.
- Summary style, depth, audience, and emphasis are user-controlled through
  natural-language prompts. Topic preferences may override global preferences.
- Publish an explicitly incomplete briefing on partial collection failure. On a
  complete failure, retain the prior dated briefing.
- Keep briefings and conversations until deleted; delete deduplication memory
  after 90 days.

Do not add email, push notifications, or general-purpose web browsing unless
the user explicitly expands scope. Use a private Cloudflare Container for the
production SearXNG process and keep the local Docker service on the same pinned
image and settings. The Worker is its only caller: never expose a public
SearXNG route, and store `SEARXNG_SECRET` only as an ignored local value or a
Cloudflare secret. Deployment remains a separately reviewed action.
The local content inspection screen and Worker integration are authorized.
Keep diagnostic routes opt-in through local bindings, disabled in deployment.
Preserve raw quality diagnostics; inspection warnings are not eligibility filters.

## Architecture

Use React + TypeScript + Vite with Cloudflare Workers Static Assets. The
personal Agent owns preferences, chat, briefing history, covered stories, and
run state in Durable Object SQLite. A Workflow owns briefing generation.

Use Google News RSS as the first discovery provider behind a replaceable
adapter, with GDELT as a second channel. Keep providers in separate files under
`src/server/discovery`, sharing normalized contracts through its entrypoint.
Discovery links are not enough evidence for detailed summaries: use
bounded article retrieval, store citations/metadata/provenance rather than full
article copies, and disclose unavailable evidence in chat.
Allow informative attributed descriptions as a labelled, limited fallback when
stronger relevant results are unavailable within budget. Never expand headline-only
metadata into substantive claims or bypass exclusions/freshness to fill slots.
Follow the status distinctions and maintain the backlog in `docs/data-pipeline.md`
when changing preferences, storage, discovery, evidence, or fallback behavior.

Keep modules deep with small interfaces. Use an adapter only when there are two
real implementations. Avoid generic repositories, DI frameworks, plugin
registries, and ORMs. Validate all browser, provider, and model input at its
runtime edge.

## Engineering rules

- Keep changes small and reviewable. Complete one planned increment, report the
  diff and validation, then wait for user review before the next increment.
- Preserve the single `npm run check` gate: format, lint, typecheck, tests, and
  production build must pass before requesting review.
- Verify changes locally: start the frontend/Worker and check the page and
  affected API routes in addition to automated checks.
- Use strict TypeScript. Add concise JSDoc comments to public entrypoints,
  exported functions, methods, classes, schemas, and types.
- Pin dependencies and retain `package-lock.json`. Target Node 24.x.
- Do not commit credentials, local Worker state, generated output, or caches.
- Maintain README deployment/setup guidance, architecture decisions, and
  `PROMPTS.md`.
- Maintain `docs/implementation-plan.md` as the milestone source of truth.
  After each increment or scope decision, update status, validation evidence,
  limitations, next slice, and the update log.
- `docs/data-pipeline.md` is the **only** actionable TODO/backlog location.
  Every open improvement, limitation requiring work, deferred decision, or
  follow-up must have one ID and status in its Improvement backlog table.
  Other documents may link to backlog IDs but must not create a second TODO
  list. Keep application-side date filtering for now; its tracked follow-up is
  DISC-06.
- Prompt history is required. Before completing every implementation increment,
  append the user request and any material AI coding prompt to `PROMPTS.md`.
  Each entry must state the date, the increment or change it informed, the
  prompt text (verbatim where practical), and a short outcome. Never recreate
  prompt history retrospectively or omit prompts because they were delivered in
  conversation rather than a tool.

## Code readability

- Separate distinct logical steps within long methods with a blank line.
- Group related variable declarations together.
- Add a blank line before control-flow transitions and final return statements.
- Avoid dense blocks of more than roughly 5–8 statements without visual
  separation.
- Prefer extracting a well-named helper when a logical section becomes
  substantial.
- Use Prettier for standard formatting and ESLint's padding-line rules for
  semantic spacing. Run their auto-fix commands before committing.
- ESLint limits cyclomatic complexity to 35, block nesting to 3 levels, nested
  callbacks to 4 levels, and statements per function to 50. Extract a named
  helper before raising a limit; adjust a limit only after documenting why the
  current codebase cannot meet it.

## Cost target

Keep the personal deployment below USD 10–20/month by capping search queries,
article retrieval, model input/output, and retries. Track usage before making
cost guarantees.
