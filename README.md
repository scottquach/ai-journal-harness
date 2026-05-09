# claude-librarian

I wanted an easy way to stream my daily thoughts into my weekly/daily markdown journal (Obsidian).

This projects provides a telegram bot that can handle both text + voice memos to reduce the friction of adding random thoughts, moods, tasks, events, grocery lists and notes into your weekly note. All within just a couple of easily modifiable files

jobs/ can be used to define proactive jobs for claude to run such as weekly reviews, checks against your monthly/yearly goals, moving tasks when the next day starts, etc.

It also supports basic retrieval activities and appending to other notes in your vault

## What it does

- **Voice logging** — send a voice message and it gets transcribed via whisper and logged automatically
- **Smart categorization** — Claude classifies entries as moods (`#mood`), events (`#event`), tasks (`- [ ]`), or general notes (`#note`) based on content
- **Markdown native** — writes directly into weekly journal files (`YYYY-Wxx.md`) under the correct day heading
- **Date-aware** — every prompt is injected with today's date, current time, week number, and pre-computed file paths so Claude always logs to the right place

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `BOT_TOKEN` | Yes | Telegram bot token from [@BotFather](https://t.me/BotFather) |
| `BOT_TIMEZONE` | Yes | IANA timezone string (e.g. `America/Los_Angeles`) — controls the date/time injected into every Claude prompt |
| `VAULT_PATH` | Yes | Absolute path to your Obsidian vault — used in `BOT.md` to grant Claude file access and set base paths |
| `OPENAI_API_KEY` | No | OpenAI API key — used by Whisper to transcribe voice messages. Omitting disables voice memo functionality |
| `DEFAULT_CHAT_ID` | No | Telegram chat ID to send proactive/scheduled messages to. Required if you use jobs with `telegram: true` |
| `ICAL_URLS` | No | Comma-separated iCal feed URLs (Google Calendar, Apple Calendar, etc.). Enables a calendar MCP tool so Claude can query your upcoming events |
| `ICAL_LABELS` | No | Comma-separated labels for each iCal feed (e.g. `Personal,Work`). Matched by position to `ICAL_URLS` |
| `CLAUDE_PATH` | No | Path to the Claude Code CLI executable. Defaults to `claude` (assumes it's on your PATH) |

`BOT_TIMEZONE` is important for journaling accuracy. Without it, "today" and the current time could default to UTC, causing entries to land in the wrong day heading.

`VAULT_PATH` is used both to grant Claude file access and as the base path in the system prompt. Journal files are expected at `$VAULT_PATH/Journal/`.

## Journal structure

Entries are written into weekly files:

```
$VAULT_PATH/Journal/
  2026-W12.md     ← weekly file with day-level sub-headings
  2026-03.md      ← monthly overview (one line per day)
```

Within a weekly file, content is organized under day headings (`## [[YYYY-MM-DD]]`). Each entry type has a distinct format:

| Type | Format | Triggered by |
|---|---|---|
| Mood | `#mood HH:MM <text>` | Mentions of feelings or emotional state |
| Event | `#event <description>` | Activities or things that happened |
| Task | `- [ ] <task>` | Action items or things to do |
| Note | `#note <text>` | Thoughts, ideas, reflections, anything else |

If you would like to modify the vault structure or behavior you can ask claude to update @BOT.md. Be as descriptive as possible with your own journal setup.

## Jobs

Jobs are defined as `.md` files in the `jobs/` directory with a YAML frontmatter header:

| Field | Required | Description |
|---|---|---|
| `name` | Yes | Identifier used in logs |
| `cron` | Yes | Cron expression for the schedule |
| `telegram` | No | Set to `true` to send output to your Telegram chat |

The body of the file is the prompt Claude receives when the job runs.

**Suppressing output:** If a job has nothing to report, instruct Claude to output exactly `[SKIP]`. The scheduler will suppress the Telegram message and skip writing that turn to conversation state. Useful for jobs that are only relevant when something actually needs attention.

## Conversation continuity

Conversation history is stored on disk as one file per chat in `conversations/chats/<chatId>.json`.

Each file contains:
- `summary` for compacted memory
- `messages` for recent user/assistant turns
- metadata like `version`, `chatId`, and `updatedAt`

Before each Claude call (user message or scheduled job), the bot builds prompt context from the stored summary and recent messages for that chat. This makes follow-up behavior durable across process restarts and enables future jobs to trim or compact older history.

## Setup

Run claude code in the directory and type `/setup` and claude will walkthrough environment setup and configurations

## Running

```bash
npm start
```

Requires [Claude Code CLI](https://github.com/anthropics/claude-code) to be installed and authenticated.
