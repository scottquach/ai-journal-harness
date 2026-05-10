---
name: nightly-maintenance
cron: '0 1 * * *'
telegram: false
---

Perform deterministic note maintenance for the current date from the context line.

Run these steps in order. Only make the specific edits described here.

## 1. Ensure required weekly notes exist

- Ensure the current week's weekly note exists. If it does not exist, create it from the weekly note template.
- If today is Friday or Saturday, also ensure next week's weekly note exists. If it does not exist, create it from the weekly note template.
- When creating a weekly note, do not populate or create any day headers.

## 2. Daily task rollover

Move unchecked tasks from yesterday into today.

- Find yesterday's `## [[YYYY-MM-DD]]` section and collect unchecked tasks from yesterday.
- Add those tasks to today's `## [[YYYY-MM-DD]]` section as unchecked `- [ ]` tasks.
- Do not review or move anything from the `This week` section in this step.
- If yesterday is Saturday and today is Sunday, read yesterday from the previous weekly note and write today into the current weekly note.
- If today's day header does not exist, create it above older day headers so day sections remain in descending date order, newest on top.
- Do not duplicate a task if the same task already exists in today's section.
- Remove moved tasks from yesterday's section after adding them to today.
- Keep task text unchanged except for normalizing the destination checkbox format to `- [ ]`.

## 3. Sunday weekly rollover

Only run this step when today is Sunday.

- Cut and paste grocery list items from the previous weekly note into the current weekly note.
- Copy unchecked tasks from the previous week's `This week` section into the current week's `This week` section.
- Do not remove the original `This week` tasks from the previous weekly note.
- Prefix each copied weekly task title with `#rollover`.
- Do not duplicate a grocery item or `#rollover` task already present in the current weekly note.

## Output

- This is a nightly maintenance, user does not need to know. Output exactly: `[SKIP]`
