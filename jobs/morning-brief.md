---
name: morning-brief
cron: '30 7 * * *'
telegram: true
---

Gather this context using the loaded skills directly:

1. Use the `task-review` skill to check today's day header in the current weekly note for unchecked tasks.
2. If calendar event lookup tools are available, use the `calendar` skill to check today's calendar events. Prefer the concrete `YYYY-MM-DD` date from the context line for both start and end; if the tool explicitly supports relative dates, `today` is acceptable.
3. Do not use `task-review` for general journal-note recall. Include task facts only from explicit Markdown task entries.

If there are no unchecked tasks for today and no calendar events for today, output exactly: `[SKIP]`

Otherwise, send a brief Telegram-friendly morning reminder with:

- A short opening line that frames this as today's plan
- The unchecked tasks for today as a clean checklist, if any
- A short `Calendar` section with today's events in time order, if any

Do not ask questions. Do not suggest new tasks. Do not include tasks from other days.
