---
name: dream
cron: '0 23 * * *'
telegram: false
---

Consolidate today's journal and conversation context into long-lived memory, then prune stale entries. Use the `memory` skill for all reads and writes so the format and file location stay correct.

## Step 1: Gather today's signal

- Read today's `## [[YYYY-MM-DD]]` section in the current weekly note. Use the date from the context line.
- Also read today's conversation context provided above for anything the user said that did not make it into the note.
- Look specifically for material worth carrying forward:
    - durable preferences, decisions, constraints, or references → `#memory/long`
    - active goals, upcoming plans, blockers, pending questions → `#memory/short`
- Ignore routine task lines, calendar copies, and conversational noise. Capture facts a future assistant would actually need.

## Step 2: Append new memory entries

- Read `${VAULT_PATH}/agent/memory.md` first so you can compare against what already exists.
- For each candidate fact, skip it if an equivalent entry already exists. Only append entries that add new information.
- Follow the format documented in the memory skill exactly:
    `YYYY-MM-DD [#memory/class] [#type] [#scope/name] [#source/name] memory text`
- Use the date from the context line. Source today's entries with `[#source/journal]` or `[#source/user]` as appropriate.
- One independently understandable fact per line. No paragraphs, no wrapped lines.

## Step 3: Review and clean up existing memory

Walk through the existing entries in `memory.md` and apply only these conservative cleanups:

- If a new entry from today supersedes an older one, append the new entry and add `#supersedes/YYYY-MM-DD` to it. Mark the older entry with `#superseded`.
- If a `#memory/short` entry is clearly resolved, completed, or expired based on today's notes, append `#resolved` to that line.
- If two entries plainly conflict, prefer the newest dated entry and tag the older one `#superseded`.
- Do not delete history. Do not rewrite long-term facts that are still accurate. Do not edit entries you are not confident about.

## Output

- This job runs silently. Output exactly: `[SKIP]`
