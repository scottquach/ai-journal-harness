# PRD: Vercel AI SDK Migration

## Summary

Migrate the Parent Agent runtime from Pi to the Vercel AI SDK while preserving the application's existing `RunParentAgent` boundary, Telegram behavior, job scheduling behavior, and Obsidian vault persistence model.

The migration should use OpenRouter as the default model provider, Vercel `bash-tool` for filesystem context retrieval, and an in-memory Vault Working Copy that writes approved diffs back to the live vault at the end of each turn.

## Goals

- Replace Pi runtime usage inside the Parent Agent adapter with Vercel AI SDK `ToolLoopAgent`.
- Keep callers dependent on the local `RunParentAgent` interface, not on Vercel AI SDK types.
- Use OpenRouter through `@openrouter/ai-sdk-provider`.
- Use Vercel-native filesystem tools: `bash`, `readFile`, and `writeFile`.
- Expose project integrations as domain-native tools, not `mcp__...` or vendor action names.
- Restore explicit app-owned conversation history for Telegram and job turns.
- Preserve scheduler turns as stateless, per the accepted scheduler ADR.
- Keep live Obsidian vault writes accurate while isolating model-visible filesystem operations in memory.

## Non-Goals

- Do not rewrite Telegram, job scheduling, dynamic scheduling, transcription, or Telegram formatting.
- Do not introduce Vercel AI Gateway as the default model path.
- Do not preserve Pi tool names as compatibility aliases.
- Do not give the Bash Tool unrestricted access to the project checkout or live filesystem.
- Do not change the domain split of parent skills unless a skill has duplicated runtime-specific guidance.

## Users

- Primary user: the owner of the personal journal assistant.
- Secondary user: future maintainers changing the agent runtime, tools, or skill instructions.

## Requirements

### Runtime Boundary

- `RunParentAgent` remains the application-facing interface.
- `bot-setup`, `job-scheduler`, and `dynamic-scheduler` continue to call `RunParentAgent`.
- Vercel AI SDK details stay inside the parent agent adapter and supporting runtime modules.

### Model Provider

- Add AI SDK dependencies:
  - `ai`
  - `bash-tool`
  - `@openrouter/ai-sdk-provider`
- Use `OPENROUTER_API_KEY` for model access.
- Replace `PI_MODEL` with `AI_MODEL`.
- Keep local aliases:
  - `gemini`
  - `sonnet`
  - `opus`
  - `haiku`
- Default to an OpenRouter model compatible with tool calling.

### Filesystem Access

- Hydrate a Vault Working Copy at the start of each turn from selected live vault files.
- Use `bash-tool` against the in-memory working copy.
- Persist only approved diffs back to mutable live vault paths at the end of the turn.
- Mutable paths:
  - `Journal/**`
  - `agent/memory.md`
- Read-only paths:
  - `agent/dynamic-schedules.md`
  - `Templates/**`
  - repo docs and skill docs
- Log changed paths in the execution log.

### Tool Names

- Use Vercel-native filesystem tools:
  - `bash`
  - `readFile`
  - `writeFile`
- Rename project-owned tools to domain-native names:
  - `scheduleTask`
  - `scheduleMessage`
  - `listSchedules`
  - `cancelSchedule`
  - `getCalendarEvents`
  - `listCalendars`
  - `listCalendarEvents`
  - `createCalendarEvent`
  - `updateCalendarEvent`
  - `deleteCalendarEvent`
- Skills should not mention `mcp__...` names or Composio action slugs.

### Skills

- Preserve the current domain skill directories:
  - `journal`
  - `memory`
  - `task-review`
  - `calendar`
  - `scheduler`
  - `strava`
- Update filesystem tool frontmatter and instructions to use `bash`, `readFile`, and `writeFile`.
- Consolidate repeated filesystem guidance into `agents/parent/BOT.md`.
- Remove references to Pi-native file tools such as `read`, `write`, `edit`, `grep`, `find`, and `ls`.

### Conversation History

- Conversation continuity is app-owned, not runtime-session-owned.
- For Telegram turns:
  - load file-backed conversation history for the chat
  - pass history as AI SDK messages
  - append successful user and assistant turns
- For job turns:
  - use the configured/default chat history when available
  - append successful output unless it is `[SKIP]`
- For scheduler turns:
  - do not load conversation history
  - do not append scheduler prompts or outputs to conversation history

### Logging

- Preserve execution logging currently provided by `src/parent-agent.ts`.
- Log turn start, model, source, chat ID, job name, tool calls, tool results, errors, output length, duration, and persisted file diffs.
- Remove stale `claude` and `pi` log prefixes during the migration.

## Rollout Plan

1. Add dependencies and configuration variables.
2. Introduce AI SDK model resolution with OpenRouter and aliases.
3. Build Vault Working Copy hydration and diff writeback.
4. Convert scheduler, calendar, and Composio adapters to AI SDK tools with domain-native names.
5. Replace Pi session creation in `src/parent-agent.ts` with `ToolLoopAgent`.
6. Reintroduce file-backed conversation history behind `RunParentAgent`.
7. Update parent skill frontmatter and instructions to Vercel-native tool names.
8. Update README environment variables and runtime documentation.
9. Remove Pi dependencies after tests prove the new adapter path.
10. Run the full test suite and add focused tests for working-copy writeback, tool names, and conversation-history source policy.

## Acceptance Criteria

- Telegram text turns still produce replies.
- Voice memo transcription still flows into the Parent Agent.
- Journal writes persist to the live Obsidian vault.
- Memory writes persist to `agent/memory.md`.
- Attempts to write read-only working-copy paths do not mutate the live vault.
- Jobs still run on cron and can send Telegram output.
- `[SKIP]` output is still suppressed.
- Dynamic scheduler tools still create, list, and cancel schedules.
- Scheduler LLM turns remain stateless.
- Calendar read/write tools use domain-native names in skill instructions.
- Tests pass with no Pi runtime dependency.

## Risks

- `bash-tool` write semantics may require a custom diff layer to distinguish legitimate edits from accidental full-file rewrites.
- AI SDK tool event shapes may not map one-to-one to the existing execution log format.
- Some OpenRouter models may have weaker tool-calling behavior than the current Pi default.
- Removing `edit` means prompt instructions must be precise about read-modify-write behavior.
- Current docs mention a dispatcher/conversation store that does not fully exist in code; the migration should resolve this rather than preserve the drift.

## Open Questions

- Which exact OpenRouter model should be the production default?
- Should writeback failures fail the whole turn or return a partial-success message to Telegram?
- How large can the hydrated working copy be before startup cost becomes noticeable?
- Should conversation history compaction be implemented in the first migration or deferred?
