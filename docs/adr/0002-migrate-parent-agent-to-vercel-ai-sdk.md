# Migrate Parent Agent to Vercel AI SDK

The **Parent Agent** will keep the existing `RunParentAgent` **Runtime Boundary**, but the implementation behind that boundary will move from Pi to the Vercel AI SDK using `ToolLoopAgent`. OpenRouter remains the default model provider through `@openrouter/ai-sdk-provider` so the project keeps its current model marketplace workflow and `OPENROUTER_API_KEY` deployment shape.

The Vercel Bash Tool will not mutate the **Live Vault** directly during tool calls. Each **Turn** hydrates a **Vault Working Copy** from allowlisted live vault files, runs filesystem tools against that in-memory copy, then writes approved diffs back to mutable vault paths at the end of the turn. This keeps filesystem context retrieval isolated without changing the assistant's user-visible promise that journal and memory changes persist to Obsidian.

Parent skills will be updated to use Vercel-native tool names instead of carrying Pi compatibility aliases. Filesystem instructions should target `bash`, `readFile`, and `writeFile`; project-owned integrations should be exposed as domain-native custom AI SDK tools such as `scheduleTask`, `getCalendarEvents`, and `createCalendarEvent` rather than `mcp__...` or vendor action names.

Conversation continuity will be owned by the application, not by long-lived runtime sessions. The AI SDK agent may be created per **Turn** with explicit message history loaded according to **Turn Source** policy: Telegram and job turns can use file-backed conversation history, while scheduler turns remain stateless as documented in the scheduler ADR.
