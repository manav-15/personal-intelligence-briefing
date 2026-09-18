# Contributing

Keep each change focused and reviewable. Run `npm run check` before requesting
review.

Use strict TypeScript and validate all browser, provider, and model data at the
runtime edge. A module should expose a small interface that hides its internal
complexity. Add an adapter only when more than one real implementation exists;
otherwise keep the behavior local.

ESLint enforces a maximum cyclomatic complexity of 35, block nesting depth of
3, nested callback depth of 4, and 50 statements per function. Extract a
well-named helper before proposing an exception.

Avoid new dependencies unless they remove substantial code or provide a needed
platform integration. Do not commit credentials, local Worker state, or
generated output. Record coding prompts in `PROMPTS.md` when they materially
direct an implementation change.
