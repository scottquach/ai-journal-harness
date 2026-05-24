# 0001. Use Pi as the Agent Runtime

Date: 2026-05-23

## Status

Accepted

## Context

The application needs a Telegram-facing agent that can read and edit an Obsidian vault, use local skills, call calendar and scheduler tools, stream progress for logs, and preserve a session per Telegram chat.

The previous implementation used `@anthropic-ai/claude-agent-sdk`, which made the runtime tightly coupled to Claude Code and Anthropic's agent harness. We considered replacing it with the Vercel AI SDK to make model switching easier, but that SDK is primarily a model and tool-calling layer. It would require rebuilding the coding-agent harness capabilities this app already depends on: filesystem tools, skill discovery, session management, and agent event flow.

Pi provides a coding-agent harness with provider switching, built-in file tools, skills, custom tools, session management, and an embeddable Node SDK.

## Decision

Use `@earendil-works/pi-coding-agent` as the parent agent runtime behind the existing `runParentAgent` application interface.

Keep Telegram, jobs, dynamic scheduling, and conversation-state code dependent on the local `RunParentAgent` type rather than on Pi directly.

Expose the existing calendar and scheduler capabilities as Pi custom tools. Preserve the existing `mcp__...` tool names for now so the current skill instructions and parent prompt remain valid.

Use `PI_MODEL=provider/model-id` for runtime model selection. Ignore the `model` value in `BOT.md` for runtime selection; it is kept as frontmatter metadata only. The built-in default is `openrouter/google/gemini-3.5-flash`, and aliases such as `gemini`, `sonnet`, `opus`, and `haiku` route through OpenRouter.

## Consequences

The application can switch between Pi-supported providers without replacing the agent harness.

The Anthropic Claude Code CLI preflight and `CLAUDE_PATH` are no longer part of the runtime path.

Pi does not provide MCP as a first-class runtime concept, so integrations that were previously MCP servers must be converted to Pi custom tools or extensions. The iCal calendar fallback and dynamic scheduler are now custom tools. Composio-backed calendar writes are not wired through Pi yet.

Pi is now the main runtime dependency. If Pi's SDK changes, the adapter in `src/parent-agent.ts` is the intended boundary for containing that churn.

OpenRouter is the default provider for the built-in model and aliases. Deployments using the default or those aliases need `OPENROUTER_API_KEY`; direct provider keys are only needed when `PI_MODEL` selects a non-OpenRouter provider.
