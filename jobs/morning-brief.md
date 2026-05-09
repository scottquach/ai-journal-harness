---
name: morning-brief
cron: '30 7 * * *'
telegram: true
---

Gather this context using the loaded skills directly:

1. Use the `task-review` skill to check today's day header in the current weekly note for unchecked tasks.
2. If calendar event lookup tools are available, use the `calendar` skill to check today's calendar events. Prefer the concrete `YYYY-MM-DD` date from the context line for both start and end; if the tool explicitly supports relative dates, `today` is acceptable.
3. Use the `task-review` skill for **thread recall**: scan the current weekly note and the previous weekly note for unfulfilled intentions ("I should X", "I want to X", "I need to X", "I'd like to X", "X would be nice/cool") from the last 7 days that never became a task and aren't already in `This week` or any day-header task list. Return at most 2 threads, only if they seem clearly worth surfacing. If nothing stands out, return nothing.

If there are no unchecked tasks for today, no calendar events for today, and no recall threads, output exactly: `[SKIP]`

Otherwise, send a brief Telegram-friendly morning reminder with:

- A short opening line that frames this as today's plan
- The unchecked tasks for today as a clean checklist, if any
- A short `Calendar` section with today's events in time order, if any
- A short `Loose threads` section with at most 2 lines, only if recall returned something. Phrase each as a gentle nudge (e.g. `Still wanted to fix the bike?`), not as a new task. Do not include this section if recall returned nothing.

Do not ask questions. Do not suggest new tasks. Do not include tasks from other days.
