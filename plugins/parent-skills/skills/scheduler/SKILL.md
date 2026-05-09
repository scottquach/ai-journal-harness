---
name: scheduler
description: Use for one-shot reminders, recurring schedules, listing active schedules, and canceling schedules.
tools:
  - mcp__scheduler__schedule_task
  - mcp__scheduler__schedule_message
  - mcp__scheduler__list_schedules
  - mcp__scheduler__cancel_schedule
---

# Scheduler Skill

Use this skill for one-shot reminders, recurring schedules, listing active schedules, and canceling schedules.

Use the scheduler MCP tools directly:

- `mcp__scheduler__schedule_task` schedules future LLM logic. Use it when the user wants a check, reminder, or recurring report that requires reading vault state or calendar data at fire time.
- `mcp__scheduler__schedule_message` pre-computes a message now and sends it later. Use it when the content is fully known today.
- `mcp__scheduler__list_schedules` lists active dynamic schedules.
- `mcp__scheduler__cancel_schedule` cancels a schedule by ID.

The `schedule` parameter accepts a cron expression or an ISO 8601 datetime. When the user gives a wall-clock time without an explicit offset, treat it as the user's timezone from `[Context: ... timezone is ...]` and pass an ISO 8601 string with that offset.

Always confirm the schedule ID back to the user after creating one.
