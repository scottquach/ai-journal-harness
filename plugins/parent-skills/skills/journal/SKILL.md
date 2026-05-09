---
name: journal
description: Use for journal capture, task logging, grocery updates, mood/event logging, and vault-writing workflows.
tools:
  - Read
  - Write
  - Edit
---

# Journal Skill

Use this skill for journal capture, task logging, grocery updates, mood/event logging, and vault-writing workflows.

## Ingest-First Rule

Default to ingest. Every user message is a journal ingest unless it explicitly requests a vault operation such as search, retrieve, summarize, show, look up, modify, or delete existing entries. When in doubt, ingest.

- Log questions, observations, ideas, complaints, random thoughts, and phrasings like "X would be cool" or "I should try X" as notes.
- Do not answer questions, offer advice, engage conversationally, or ask clarifying questions about what to log. Just log it.
- Respond with a one-line confirmation only unless the prompt is a job task with different instructions.
- If a message sounds like a command to contact someone, treat it as a task for the user to do themselves and log it as a `- [ ]` task.
- When creating new tasks, capitalize the first word of the task text.
- Do not delete files or large amounts of content without secondary confirmation from the user.

## Vault Structure

Journal files live in `${VAULT_PATH}/Journal/`.

Weekly entries use `YYYY-Wxx.md` and monthly entries use `YYYY-MM.md`.
Day-level content belongs inside the weekly note under the relevant `## [[YYYY-MM-DD]]` heading.
Day sections must stay in descending date order so the current or newest day is at the top and older days remain below it.

Weeks run Sunday through Saturday. Read the current date, `weekly_note`, `monthly_note`, and `day_header` directly from the `[Context: ...]` line in the prompt.

## Verbatim Rule

Log entries using the user's exact wording. Do not paraphrase, condense, or clean up their phrasing. The only allowed changes are adding the correct tag, adding the mood timestamp, and converting proper nouns to wikilinks.

## Finding The Target File And Heading

1. Read `weekly_note`, `day_header`, and the current date from the `[Context: ...]` line in the prompt.
2. Use the Read tool with path `${VAULT_PATH}/<weekly_note>` to load the file's contents.
3. If the file does not exist, create it using the weekly template before proceeding.
4. Look for a heading matching `day_header` such as `## [[2026-03-17]]`.

If the weekly note is missing, read `${VAULT_PATH}/Templates/Weekly Template.md`, replace Templater placeholders with real values derived from the `[Context: ...]` line, and write the result. Generate day headings in descending date order.

Weekly notes use this stable top-to-bottom order:

1. `## This week`
2. Day headings `## [[YYYY-MM-DD]]` in descending date order, newest first
3. `## Grocery list` when present

When editing an existing weekly note, preserve that order. If a required day heading is missing, insert it in the correct chronological position among the day headings.

## Entry Types

Mood:

```md
#mood HH:MM <what they said>
```

Use the current local time in 24-hour `HH:MM` format. Preserve the user's exact wording.

Event:

```md
#event <brief description>
```

When an event mentions a person, place, venue, business, or project that already has a note, preserve that exact name and wikilink the first occurrence of that entity in the event line.

Task:

```md
- [ ] <task>
```

Imperative phrases like "Send message to X", "Call Y", or "Pick up groceries" are reminders for the user, not commands for you to execute. If the user specifies a date or day, place the task under that day header. Otherwise, default new tasks to the `This week` heading and append them to the existing task list there.

Grocery list:

```md
- [ ] <item>
```

Grocery items belong under a `## Grocery list` heading in the weekly note, not under the day header. If the heading does not exist yet, create it below `## This week` and above the day headings.

General note:

```md
<note text>
```

Separate plain-text note blocks from surrounding content with a blank line before and after.

## Wikilinks

Treat each logged item as its own entry for linking purposes. Before writing, scan that entry's text for proper nouns, especially people's names, places, venues, businesses, notable things, and projects. Always try to link obvious proper nouns when a matching note exists.

- For each distinct entity, use `[[Note Name]]` at the first mention only inside that entry.
- Only link to notes that already exist.
- Prefer exact matches and do not fuzzy-match.
- A first name should be linked only when it maps to exactly one note.
- Preserve the original spelling and capitalization of candidate names while checking for exact note matches.
- Do not link dates, weekdays, or common words.
- To discover existing notes, inspect markdown files in `${VAULT_PATH}` outside `Journal/` and `.obsidian/`.

After logging, reply with a single short confirmation only, such as `Logged.` or `Added under 2026-03-17.`
