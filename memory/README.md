# Memory Vault

Open this folder as an Obsidian vault. Use `memory.md` as the compact memory log.

## Files

- `memory.md` - one-line facts, preferences, references, goals, and other assistant memory.
- `Jobs/` - longer notes for scheduled jobs or active state.
- `Templates/` - reusable note templates.
- `Dashboards/` - generated or hand-maintained views.

## Memory Format

Write one memory per line:

```text
YYYY-MM-DD [#memory/short|#memory/long] [#type] [#scope/name] [#source/name] memory text
```

Use ISO dates in local time for when the memory was set.

Example:

```text
2026-05-10 [#memory/long] [#pref] [#user/scott] [#source/user] User prefers Markdown and Obsidian for assistant-visible state.
```

## Memory Classes

- `#memory/short` - temporary context: current goals, upcoming items, blockers, pending questions, active plans.
- `#memory/long` - durable context: facts, preferences, references, decisions, constraints.

## Common Tags

- Types: `#fact`, `#pref`, `#ref`, `#decision`, `#constraint`, `#goal`, `#upcoming`, `#todo`, `#stale`
- Scopes: `#user/name`, `#project/name`, `#repo/name`, `#tool/name`, `#workflow/name`, `#assistant/state`
- Sources: `#source/user`, `#source/inferred`, `#source/file`, `#source/web`, `#source/tool`
- Status: `#active`, `#superseded`, `#needs-review`, `#supersedes/date-or-id`

## Rules

- Prefer appending new lines over editing history.
- Keep every line independently understandable.
- Use lowercase kebab-case tags.
- Review `#memory/short` entries periodically and clear or supersede stale ones.
- Put long explanations in separate notes and reference them from `memory.md`.
