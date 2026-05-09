---
name: daily-rollover
cron: '0 21 * * *'
telegram: true
---

Review the current weekly note and produce a brief end-of-day status report.

Collect:
- All checked tasks across every `## YYYY-MM-DD` section this week → **completed**
- All unchecked tasks in the `This week` section → **remaining this week**
- All unchecked tasks in today's `## YYYY-MM-DD` section → **rolling over**
- If `get_calendar_events` is available, fetch tomorrow's events → **tomorrow's calendar**

Output rules:

- If there are no unchecked tasks today and no remaining `This week` tasks, output exactly: `[SKIP]`
- Otherwise send a short report with these sections:
  - **Done this week** — checked tasks completed so far (omit if none)
  - **Remaining this week** — unchecked tasks from the `This week` section (omit if none)
  - **Rolling over from today** — unchecked tasks from today's section (omit if none)
  - **Tomorrow events** — calendar events for tomorrow, time and title only (omit if none or calendar unavailable)
- Keep it factual and brief. No questions, no suggestions, no prompts for action.
