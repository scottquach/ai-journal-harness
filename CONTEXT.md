# Project Context

Shared vocabulary for the personal journal assistant. Architecture reviews and refactoring
discussions should use these terms consistently.

## Language

**Turn**
One input handed to the **Parent Agent** paired with its single output.
_Avoid_: request, message, run

**Turn Source**
The origin of a **Turn**, currently `telegram`, `job`, or `scheduler`.
_Avoid_: caller, trigger

**Parent Agent**
The Telegram-facing assistant that reads the user's context and performs vault, calendar, memory, and scheduling work directly.
_Avoid_: bot, Claude, Pi

**Runtime Boundary**
The application-facing interface used to invoke the **Parent Agent**, independent of the underlying agent runtime.
_Avoid_: SDK boundary, provider wrapper

**Live Vault**
The user's real Obsidian vault on disk.
_Avoid_: memory, workspace

**Vault Working Copy**
An isolated copy of selected **Live Vault** files used by a **Turn** before approved changes are written back.
_Avoid_: sandbox, cache, snapshot

**Domain Tool**
A project-owned tool named after the capability it exposes to the **Parent Agent**, independent of the vendor or adapter that implements it.
_Avoid_: MCP tool, Composio tool, provider tool

## Relationships

- A **Turn** has exactly one **Turn Source**.
- The **Runtime Boundary** invokes exactly one **Parent Agent**.
- A **Vault Working Copy** is hydrated from the **Live Vault**.
- A **Vault Working Copy** may write approved changes back to the **Live Vault**.
- A **Domain Tool** may wrap an external integration.

## Example Dialogue

> **Dev:** "Should Telegram know whether the Parent Agent uses Pi or the Vercel AI SDK?"
> **Domain expert:** "No. Telegram sends a Turn through the Runtime Boundary; the runtime behind that boundary can change."

> **Dev:** "Can the agent edit the Live Vault directly during tool calls?"
> **Domain expert:** "No. It should work in a Vault Working Copy and write approved changes back after the Turn."

> **Dev:** "Should the calendar skill call a Composio action name?"
> **Domain expert:** "No. It should call a Domain Tool like createCalendarEvent; the adapter can decide whether Composio implements it."

## Flagged Ambiguities

- "memory" can mean model conversation history, assistant memory notes, or an in-memory filesystem. Use **Vault Working Copy** for the in-memory filesystem and say "conversation history" or "assistant memory" for the other meanings.
- "tool" can mean a model-visible capability, a Vercel Bash Tool primitive, or a vendor-specific integration action. Use **Domain Tool** for project-owned model-visible integration capabilities.
