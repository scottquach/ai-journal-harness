# ADR-0001: Scheduler turns bypass conversation state

## Status

Accepted.

## Context

Three callers invoke the parent agent (see [CONTEXT.md](../../CONTEXT.md)
for terms):

- `bot-setup` — interactive Telegram turns, user-driven.
- `job-scheduler` — cron-driven turns defined in `jobs/*.md`.
- `dynamic-scheduler` — turns the agent itself schedules at runtime
  (via the `scheduler` MCP tools `schedule_task` / `schedule_message`).

`bot-setup` and `job-scheduler` participate in the conversation store:
the prompt is enriched with recent messages on the way in
(`conversationStore.buildPrompt`) and the resulting turn is appended on
the way out (`conversationStore.appendTurn`). `dynamic-scheduler` does
neither — scheduled LLM tasks run with only the date context and the raw
scheduled prompt.

## Decision

Scheduler turns deliberately bypass the conversation store. They neither
read history on the way in nor write history on the way out. This is a
property of `source: 'scheduler'` and is enforced by the dispatcher
(`src/dispatch-turn.ts`).

## Reason

Scheduled tasks are stateless instruments, not dialogue. They run
because a cron fired, not because anyone is conversing. Pulling
"Recent messages" into their context would mean a 9am calendar check
sees a fragment of last night's chat — irrelevant at best, misleading
at worst. Writing the scheduled prompt back as `User: …` would then
pollute the next interactive turn's context with cron-authored messages
that no human ever typed.

`job-scheduler` participates despite also being cron-driven because
jobs are defined by the user as part of their assistant — their outputs
are part of the dialogue the user has with the agent over time. Dynamic
schedules are operational instructions the agent issues to itself; they
should not bleed into the user-facing conversation.

## Consequence

- Dynamic LLM tasks must be written self-contained. The agent cannot rely
  on conversation context being available when it schedules a task for
  itself.
- If a future use case needs scheduled tasks to see history, revisit this
  ADR rather than adding a per-schedule opt-in flag. A per-schedule flag
  is the obvious first refactor and is rejected here as scope creep —
  it shifts the policy from the dispatcher to every callsite that creates
  a schedule.
