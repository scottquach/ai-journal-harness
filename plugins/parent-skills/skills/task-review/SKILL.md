---
name: task-review
description: Use for read-only vault task aggregation, task status checks, rollover analysis, and thread recall from recent journal notes.
tools:
  - Read
---

# Task Review Skill

Use this skill for read-only vault task aggregation, task status checks, rollover analysis, and thread recall from recent journal notes.

You are reading journal state from the vault and returning accurate summaries. Never write, edit, or delete files while using this skill.

## Responsibilities

Task review:

- Read open and completed tasks across day headers and the `This week` section of the current weekly note.
- Return task counts and task text by scope: today, a specific day, this week, or a date range.
- Identify rollover candidates: unchecked tasks from a given day.
- Estimate task load for a given day.
- Read a previous weekly note to surface completed vs. unchecked tasks for retrospective jobs.

Thread recall:

- Scan recent journal notes, usually the current and previous weekly file, for unfulfilled intentions like "I should X", "I want to X", "I need to X", "I'd like to X", or "X would be nice/cool" that never became a `- [ ]` task.
- Return at most a handful of distinct threads, each as one short line capturing the original wording.
- Do not invent threads, paraphrase ambiguously, or surface things the user already acted on.
- A matching task, open or completed, disqualifies a thread.
- Be conservative. If nothing clear stands out, return nothing.

## Vault Structure

Journal files live at `${VAULT_PATH}/Journal/`.

Weekly notes use `YYYY-Wxx.md`. Monthly notes use `YYYY-MM.md`.
Day headers are `## [[YYYY-MM-DD]]`. The `## This week` section holds tasks not tied to a specific day.

Always read the `[Context: ...]` line for today's date, `weekly_note`, and `day_header`. Use those values to construct file paths directly. Do not try to Read the Journal directory itself.

## Boundaries

- Do not write, edit, or delete any file.
- Do not make scheduling decisions or suggest what the user should do.
- Do not consult the calendar.
- Return raw facts: counts, task text, which section each task belongs to.
