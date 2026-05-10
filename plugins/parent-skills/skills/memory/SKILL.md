---
name: memory
description: Use for reading, adding, reviewing, or updating assistant memory, including short-term goals and long-term facts, preferences, references, decisions, and constraints from the user.
tools:
    - Read
    - Write
    - Edit
---

# Memory Skill

Use this skill when the user asks to remember something, update memory, recall stored preferences or facts, maintain assistant state, or manage short-term goals and long-term reference knowledge.

## Files

Memory lives in `${PROJECT_ROOT}/memory/vault`.

- `memory.md` is the compact line-oriented memory log.
- `README.md` documents the memory format and tags.
- Longer state, scheduled jobs, or dashboards can live in nearby notes, but `memory.md` is the index for durable memory.

Read `memory/vault/README.md` before changing the memory format. Read `memory/vault/memory.md` before answering memory recall questions or deciding whether a new entry supersedes an old one.

## Memory Classes

- `#memory/short` - temporary working context, upcoming tasks, active goals, blockers, pending questions, and plans that should eventually expire.
- `#memory/long` - durable facts, preferences, references, decisions, and constraints. Long-term memory may change, but it should be treated as stable until superseded.

## Entry Format

Append one independently understandable memory per line:

```text
YYYY-MM-DD [#memory/class] [#type] [#scope/name] [#source/name] memory text
```

Use the current local date from the prompt context. If no current date is provided, use the system date.

Example:

```text
2026-05-10 [#memory/long] [#pref] [#user/scott] [#source/user] User prefers Markdown and Obsidian for assistant-visible state.
```

## Write Rules

- Prefer appending a new line over editing history.
- Do not add vague or conversational memories; write only facts likely to be useful later.
- Use `#memory/short` for goals and upcoming context that should be reviewed or cleared.
- Use `#memory/long` for stable user preferences, project references, decisions, and constraints.
- If replacing an older entry, append the new entry and add a status tag such as `#supersedes/2026-05-10` when useful. Update the superseded entry with `#superseded`.
- Keep each line grep-friendly: no wrapped lines, no paragraphs, no nested Markdown.

## Recall Rules

- For user preferences and project facts, prefer `#memory/long` entries unless a newer short-term goal clearly overrides the immediate context.
- Treat `#memory/short` as active working context, not permanent truth.
- If entries conflict, prefer the newest dated entry and mention the conflict briefly when it affects the answer.
- If memory is missing or stale, say so instead of inferring a stored preference.
