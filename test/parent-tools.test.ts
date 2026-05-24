import assert from 'node:assert/strict';
import test from 'node:test';
import { createParentTools, splitCsv } from '../src/parent-tools.js';
import type { DynamicScheduler } from '../src/dynamic-scheduler.js';

function makeScheduler(): DynamicScheduler {
    return {
        cancelSchedule: () => false,
        listSchedules: () => [],
        reloadFromDisk: () => undefined,
        scheduleMessage: () => 'message-id',
        scheduleTask: () => 'task-id',
    };
}

test('splitCsv trims whitespace and drops empty entries', () => {
    assert.deepEqual(splitCsv(' Personal, ,Work '), ['Personal', 'Work']);
});

test('createParentTools keeps iCal calendar tool when Composio key is also configured', () => {
    const tools = createParentTools(
        {
            composioConsumerApiKey: 'configured',
            icalLabels: 'Personal',
            icalUrls: 'https://example.com/calendar.ics',
        },
        makeScheduler(),
    );

    assert.ok(tools.some((tool) => tool.name === 'mcp__calendar__get_calendar_events'));
    assert.ok(tools.some((tool) => tool.name === 'mcp__composio__GOOGLECALENDAR_EVENTS_LIST_ALL_CALENDARS'));
    assert.ok(tools.some((tool) => tool.name === 'mcp__scheduler__schedule_task'));
});

test('createParentTools does not expose iCal tool without ICAL_URLS', () => {
    const tools = createParentTools({ composioConsumerApiKey: 'configured' }, makeScheduler());

    assert.equal(tools.some((tool) => tool.name === 'mcp__calendar__get_calendar_events'), false);
    assert.ok(tools.some((tool) => tool.name === 'mcp__composio__GOOGLECALENDAR_EVENTS_LIST_ALL_CALENDARS'));
    assert.ok(tools.some((tool) => tool.name === 'mcp__scheduler__schedule_task'));
});
