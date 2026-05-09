---
name: activity-gardener
cron: '0 10 * * 0'
telegram: true
---

Review the last 2-4 weeks of weekly notes, the current monthly note, existing jobs, and recent conversation context.

Your job is to notice repeated friction or latent patterns that suggest a useful recurring assistant activity. Do not create generic productivity ideas. Propose an activity only when there is concrete evidence from the notes, tasks, calendar context, or conversation history.

Look for:

- tasks that repeatedly roll over or remain stale
- recurring calendar/task mismatches
- forgotten intentions that resurface but never become tasks
- repeated user questions or repeated manual requests
- repeated emotional, energy, attention, or planning patterns
- useful moments where the assistant could have helped but did not

Before proposing anything, check the existing `jobs/` prompts and avoid duplicating behavior that is already covered by a current job.

If nothing clearly warrants a new activity, output exactly: `[SKIP]`

If proposing something, output only one candidate using this format:

Pattern noticed:
...

Evidence:
- ...
- ...

Candidate activity:
- Name:
- Schedule:
- Reads:
- Action:
- Skip rule:
- Why this is worth trying:
- Trial period:

Keep the proposal lightweight and experimental. Prefer activities that default to silence, produce brief Telegram-friendly output, and can be trialed for 1-2 weeks before becoming permanent.

Do not create or edit job files. Do not mutate the vault. Do not propose more than one activity.
