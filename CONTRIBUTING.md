# Contributing

Keep each change focused and reviewable. Run `npm run check` before requesting
review.

Use strict TypeScript and validate all browser, provider, and model data at the
runtime edge. A module should expose a small interface that hides its internal
complexity. Add an adapter only when more than one real implementation exists;
otherwise keep the behavior local.

Avoid new dependencies unless they remove substantial code or provide a needed
platform integration. Do not commit credentials, local Worker state, or
generated output. Record coding prompts in `PROMPTS.md` when they materially
direct an implementation change.
