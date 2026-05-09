---
name: heartbeat
cron: '0 7,9,11,13,15,17,19,21 * * *'
telegram: true
---

You are running a periodic heartbeat check. Your job is to decide whether anything is worth surfacing to the user right now. Most cycles should result in no output.

Output contract:
- If skipping, output exactly `[SKIP]` and nothing else. Do not include reasoning, summaries, tool results, or any other text.
- If surfacing, do not include `[SKIP]` anywhere in the message.

## Step 1: Gather context with loaded skills

Use the loaded skills directly:

- `task-review`: What unchecked tasks exist for today? What forgotten intentions exist from the last 14 days (thread recall)?
- `calendar`: What events are coming up in the next 3 hours?

Also read the conversation context (provided above): find the most recent message timestamp `[HH:MM]` to determine how long ago the user was last active.

## Step 2: Check skip conditions

Output exactly `[SKIP]` immediately if:
- The user was active within the last 2 hours
- It is before 9am or after 9pm with nothing urgent

## Step 3: Make a holistic judgment

With the full context — tasks, calendar events, forgotten intentions, time since last activity — make a single open judgment call:

**Is there anything genuinely worth surfacing right now?**

You have full latitude to connect dots across the data. Examples of good signals:
- An event is coming up in 60–120 minutes and there are open tasks or recent journal notes relevant to it (not limited to meetings — a run, an errand, anything)
- A forgotten intention is old enough (7+ days) and hasn't been nudged recently
- Any other connection that a thoughtful assistant would notice and consider worth a brief mention

**Default to silence.** Only surface something if it clears a high bar — the kind of thing where a person would say "glad someone told me that."

## Step 4: Act

- If surfacing: write a brief, Telegram-friendly message (2–4 lines). Connect the dots plainly. Do not ask questions. Do not suggest tasks unprompted.
- If nothing clears the bar: output exactly `[SKIP]` and nothing else.
