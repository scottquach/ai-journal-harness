---
name: calendar
description: Use for calendar lookups, schedule questions, availability checks, event summaries, and calendar event mutations when supported.
tools:
  - mcp__composio__*
  - mcp__calendar__get_calendar_events
---

# Calendar Skill

Use this skill for calendar lookups, schedule questions, availability checks, event summaries, and calendar event mutations if the active tool list supports them.

Use the Composio Google Calendar tools to create, update, delete, and answer questions about events, schedule, time windows, and availability. If only the local iCal fallback is available, use it only for read-only event lookup.

When backed by Composio, use tools named like `mcp__composio__GOOGLECALENDAR_EVENTS_LIST_ALL_CALENDARS`, `mcp__composio__GOOGLECALENDAR_EVENTS_LIST`, `mcp__composio__GOOGLECALENDAR_CREATE_EVENT`, `mcp__composio__GOOGLECALENDAR_PATCH_EVENT`, `mcp__composio__GOOGLECALENDAR_UPDATE_EVENT`, and `mcp__composio__GOOGLECALENDAR_DELETE_EVENT`. These tools are Pi custom tool adapters that execute Composio actions; pass the Composio action parameters inside the tool's `arguments` object. When backed by the iCal fallback, only `mcp__calendar__get_calendar_events` is available. Do not use Google Calendar tools exposed by a generic `mcp__calendar__...` server; this project routes Google Calendar through Composio.

## Responsibilities

- Look up upcoming events, date ranges, and matches for calendar queries.
- Create calendar events when the user asks to add something to the calendar.
- Update or delete calendar events when the user asks and the matching tool is available.
- Summarize the user's schedule clearly and concisely.
- Answer availability questions based on the events returned by the calendar tool.
- Use the `[Context: ...]` line for the local date and time framing when it matters.

## Calendar Writes

When the user asks to add a calendar event:

1. Resolve relative dates and times from the `[Context: ...]` line.
2. Use the available `mcp__composio__GOOGLECALENDAR_CREATE_EVENT` tool if it is exposed.
3. Put all Composio action parameters under `arguments`.
4. If the user does not give a duration, default to 30 minutes.
5. If the user says "no reminder" or "no reminders", disable reminders/notifications using the tool's supported parameter.
6. Do not add participants unless the user explicitly names attendees.
7. Do not add a Google Meet link unless the user explicitly asks for one.
8. Confirm the event title, date, and time after creation.

Calendar tools appear directly in your active tool list when the runtime is configured; a second Skill invocation will not make them visible. If no `mcp__composio__*` tools appear in your tool list when this skill runs, report immediately that calendar writes are unavailable in this session and stop. The `mcp__calendar__get_calendar_events` fallback is read-only.

## User Context

- Primary Google account: scottqglobal@gmail.com
- When creating calendar events, do not include participants and pass `exclude_organizer: true`.
- When creating calendar events, do not include a Google Meet link. Set `create_meeting_room: false` or equivalent.

## Boundaries

- Do not edit journal files or mutate the vault unless the task is explicitly a journaling action informed by calendar data.
- If calendar access is unavailable, respond briefly that calendar data is not configured.
