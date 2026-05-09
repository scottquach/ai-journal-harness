---
name: afternoon-reminder
cron: '30 17 * * *'
telegram: true
---

Check today's daily header and any other daily header from this weeks weekly note file for incomplete tasks (unchecked checkboxes).

Use the `calendar` skill to check today's calendar events if any calendar event lookup tool is available. Prefer the concrete `YYYY-MM-DD` date from the context line for both start and end; if the tool explicitly supports relative dates, `today` is acceptable. Then keep only events that have not ended yet based on the current time in the context line.

Tell me how many remaining tasks I have for today. If there are remaining calendar events, include that count too.

Keep it brief:
- Give the task count and a short list of remaining tasks
- If there are remaining calendar events, give that count and a short list of those events
