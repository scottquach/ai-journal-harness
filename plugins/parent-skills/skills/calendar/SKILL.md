---
name: calendar
description: Use for calendar lookups, schedule questions, availability checks, event summaries, and calendar event mutations when supported.
tools:
  - mcp__calendar__*
---

# Calendar Skill

Use this skill for calendar lookups, schedule questions, availability checks, event summaries, and calendar event mutations if the active MCP server supports them.

Use the calendar MCP tools to create, update, delete, and answer questions about events, schedule, time windows, and availability.

When backed by Composio, tools like `GOOGLECALENDAR_LIST_EVENTS`, `GOOGLECALENDAR_CREATE_EVENT`, `GOOGLECALENDAR_UPDATE_EVENT`, and `GOOGLECALENDAR_DELETE_EVENT` may be available. When backed by the iCal fallback, only `get_calendar_events` is available. Use whatever tools the server exposes.

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
2. Use the available calendar create-event tool if one is exposed.
3. If the user does not give a duration, default to 30 minutes.
4. If the user says "no reminder" or "no reminders", disable reminders/notifications using the tool's supported parameter.
5. Do not add participants unless the user explicitly names attendees.
6. Do not add a Google Meet link unless the user explicitly asks for one.
7. Confirm the event title, date, and time after creation.

Calendar MCP tools appear directly in your active tool list when the server is connected — a second Skill invocation will not make them visible. If no `mcp__calendar__*` tools appear in your tool list when this skill runs, report immediately that calendar writes are unavailable in this session and stop.

## User Context

- Primary Google account: scottqglobal@gmail.com
- When creating calendar events, do not include participants and pass `exclude_organizer: true`.
- When creating calendar events, do not include a Google Meet link. Set `create_meeting_room: false` or equivalent.

## Boundaries

- Do not edit journal files or mutate the vault unless the task is explicitly a journaling action informed by calendar data.
- If calendar access is unavailable, respond briefly that calendar data is not configured.
