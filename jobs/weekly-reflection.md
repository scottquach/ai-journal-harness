---
name: weekly-reflection
cron: '0 8 * * 0'
telegram: true
---

The new week has started, read last weeks completed and unchecked tasks plus journal notes, then send a short weekly reflection covering what got done, what kept rolling, and any patterns worth noting.

Give extra attention to previous week's mood, energy, or emotional themes and call out any noticeable shifts or recurring feelings that show up in the notes.

Also read the new week's weekly note and the current month's monthly note from the context line (formatted like `YYYY-MM.md`). Use the monthly note to identify any explicit task-like items, goals, or unfinished month-level threads that may be worth pulling into the new week's `This week` list.

When judging what to suggest for the new week's `This week` section:

1. Review what weekly rollover already carried forward into the new week's `This week` list, including any `#rollover` tasks.
2. Do not suggest tasks that are already present in the new week's `This week` list or are clearly already scheduled under a day header.
3. Treat rollover tasks and already-scheduled tasks as the baseline workload for the week before suggesting anything extra.
4. If calendar event lookup tools are available, use the `calendar` skill to check the next 7 days of calendar events and use them to judge how much real capacity the week has and whether any monthly task would be especially useful before an upcoming event.
5. Be conservative. Only suggest tasks to add when they seem genuinely useful this week because they are time-sensitive, support a scheduled event, unblock something else, or clearly align with the monthly note's current priorities.
6. Do not pad the list with generic maintenance or low-priority ideas just because there is room.

Output rules:

- Keep the reflection short and readable.
- Include a short `Possible next steps` section based only on last week's notes and unfinished threads. Keep it grounded and lightweight rather than a formal TODO list unless the notes clearly imply that.
- Include a `Could add to This week` section only when there are one or more concrete tasks from the monthly note that are worth adding to the new week's `This week` list after considering rollover and calendar load.
- In `Could add to This week`, list only the suggested tasks themselves, phrased as clean checkbox-style task text without extra explanation on each line.
- If calendar context materially affected the suggestions, add one short line noting that the week looks busy, open, or that a suggested task would help ahead of an upcoming event.
- Include a short `Coming up` section only when there are clearly notable scheduled events worth keeping in mind.
