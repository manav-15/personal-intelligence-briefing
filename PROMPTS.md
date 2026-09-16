# Prompt history

This record satisfies the Cloudflare assignment's request to submit AI coding
prompt history. Prompts are kept verbatim where practical and summarized only
when repeated conversational turns contain the same settled decision.

## Recording rule

Before an implementation increment is reported complete, append the user
request and each material AI coding prompt with its date, affected increment,
verbatim text where practical, and outcome. Conversation-delivered prompts are
part of this record.

## Product definition

> Help me build a Personal Intelligence Briefing Agent for daily use and
> Cloudflare's AI application assignment. Users configure topics through
> natural-language prompts, specifying interests, exclusions, sources, reading
> length, and schedule. The agent collects news, deduplicates stories, ranks
> relevance, and creates concise briefings with source citations. Start with
> selected RSS feeds and official release feeds.

> Build a responsive React + TypeScript web app with Today, Chat, Topics,
> Archive, and Memory/Settings. Chat supports follow-up questions about stories.
> Persist editable preferences, conversation history, and previously covered
> stories. Use Cloudflare Workers with Static Assets, Agents SDK/AIChatAgent,
> Durable Object SQLite, scheduled tasks, Workflows, Workers AI, and Cloudflare
> Access. Defer email, push notifications, and broad web search.

## Settled product decisions

- Initial interests: AI, geopolitics/major world news, Premier League, and
  Liverpool FC.
- Summaries retain links and lightweight provenance. The design must allow
  future full-article retrieval for better chat quality.
- Users review and apply proposed preference changes.
- A five-minute daily briefing is due at 08:00 Asia/Kolkata; substantial updates
  are resurfaced with a description of what changed.
- Use keyword discovery that scales to arbitrary topics, initially Google News
  RSS behind a replaceable provider interface; perform bounded article retrieval
  before substantive summaries.
- Publish partial briefings with an incomplete label. Retain briefings and chat
  until deletion; retain deduplication data for 90 days.

## Implementation prompt: increment 1

> Initialize Git locally and scaffold a single React + TypeScript + Vite
> Cloudflare Workers application. Introduce strict TypeScript, ESLint, Prettier,
> Vitest, a single full quality-check command, documentation, prompt history,
> and CI. Keep the visible app limited to a verified foundation until the next
> reviewed increment.

**Outcome (2026-09-17):** Created the Git repository, React/Worker scaffold,
strict quality gate, baseline health route and tests, CI, architecture docs, and
repository instructions. Verified the local frontend and Worker health route.

## Repository instruction prompt

> Update AGENTS.md file with the basic instructions discussed here and whatever
> rules/preferences we discuss. Also add comments to all public entrypoints and
> methods. Need to keep storing prompts as well right? add it in instructions.

**Outcome (2026-09-17):** Added repository instructions for the agreed product,
architecture, engineering rules, public-entrypoint documentation, and mandatory
prompt-history recording.
