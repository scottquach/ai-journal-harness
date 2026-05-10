# Memory

Use the configured Obsidian vault from `.env`:

```text
${VAULT_PATH}/agent/
```

This repository's `memory/` folder only tracks conventions and templates. The live synced files should be created in `${VAULT_PATH}/agent`, not in a repo-local memory folder.

Expected files:

- `${VAULT_PATH}/agent/memory.md` - compact line-oriented assistant memory.
- `${VAULT_PATH}/agent/dynamic-schedules.md` - read-only scheduler visibility file written by the dynamic scheduler.

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
- Put long explanations in separate notes under `${VAULT_PATH}/agent` and reference them from `${VAULT_PATH}/agent/memory.md`.
- Treat scheduler-generated files such as `dynamic-schedules.md` as read-only visibility files; change schedules through the scheduler tools instead.
