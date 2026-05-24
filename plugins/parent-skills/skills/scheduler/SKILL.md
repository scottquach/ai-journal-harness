---
name: scheduler
description: Use for one-shot reminders, recurring schedules, listing active schedules, and canceling schedules.
tools:
  - scheduleTask
  - scheduleMessage
  - listSchedules
  - cancelSchedule
---

# Scheduler Skill

Use this skill for one-shot reminders, recurring schedules, listing active schedules, and canceling schedules.

Use the scheduler domain tools directly:

- `scheduleTask` schedules future LLM logic. Use it when the user wants a check, reminder, or recurring report that requires reading vault state or calendar data at fire time.
- `scheduleMessage` pre-computes a message now and sends it later. Use it when the content is fully known today.
- `listSchedules` lists active dynamic schedules.
- `cancelSchedule` cancels a schedule by ID.

The `schedule` parameter accepts a cron expression or an ISO 8601 datetime. When the user gives a wall-clock time without an explicit offset, treat it as the user's timezone from `[Context: ... timezone is ...]` and pass an ISO 8601 string with that offset.

Always confirm the schedule ID back to the user after creating one.
