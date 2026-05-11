# Project context

Shared vocabulary for the codebase. Architecture reviews and refactoring
discussions should use these terms exactly.

## Terms

**Turn**
One input handed to the parent agent paired with the parent agent's single
output. A turn has a `source` (`telegram`, `job`, or `scheduler`) that
determines its lifecycle — whether the conversation store is consulted on
the way in, whether the output is recorded on the way out, whether `[SKIP]`
suppresses delivery, and how failures are surfaced to the user.

**Dispatcher**
The module that owns a turn's lifecycle end-to-end: building the prompt
(when applicable), invoking the parent agent, applying the `[SKIP]` rule,
appending to the conversation store (when applicable), formatting and
delivering the output to Telegram, and handling failures. Callers
(`bot-setup`, `job-scheduler`, `dynamic-scheduler`) hand the dispatcher an
input and a destination; they do not touch the conversation store or the
Telegram client directly.

See `src/dispatch-turn.ts` for the dispatcher; see
`docs/adr/0001-scheduler-bypasses-conversation-state.md` for the
source-gated conversation policy.
