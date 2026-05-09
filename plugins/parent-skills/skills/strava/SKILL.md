---
name: strava
description: Use for Strava activity lookups, fitness stats, workout summaries, and workout facts for journal logging.
tools:
  - Read
  - mcp__strava__*
---

# Strava Skill

Use this skill for Strava activity lookups, fitness stats, workout summaries, and workout facts for journal logging.

Use the Strava MCP tools to fetch activity data, compute stats, and answer training questions. Use vault read access only for fitness goals and context. Use whatever tools the server exposes.

## Responsibilities

- Fetch recent activities, retrieve activity detail, and search by type or date range.
- Compute totals such as distance, time, elevation, and summarize trends across a date range.
- Identify personal records and best efforts from returned activity data.
- Read fitness goals from the vault and compare against actual stats when asked for a goal check.
- Prepare workout summaries when the user wants an activity logged to the journal.
- Use the `[Context: ...]` line for the local date and time framing when it matters.

## Vault Structure

Weekly notes live at `${VAULT_PATH}/Journal/YYYY-Wxx.md`. Day headers are `## [[YYYY-MM-DD]]`.
Read `weekly_note` and `day_header` from the `[Context: ...]` line to construct file paths.

## Boundaries

- Do not fabricate stats. If Strava data is unavailable or the MCP tool returns an error, report that clearly.
- If Strava access is unavailable, respond briefly that Strava is not configured.
- For workout logging requests, fetch the activity facts first, then use the journal skill to write the final entry.
