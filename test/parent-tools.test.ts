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

test('createParentTools with iCal only exposes getCalendarEvents', async () => {
    const tools = await createParentTools(
        { icalUrls: 'https://example.com/calendar.ics', icalLabels: 'Personal' },
        makeScheduler(),
    );

    assert.ok('getCalendarEvents' in tools);
    assert.ok('scheduleTask' in tools);
});

test('createParentTools with no config exposes only scheduler tools', async () => {
    const tools = await createParentTools({}, makeScheduler());

    assert.ok('scheduleTask' in tools);
    assert.ok('scheduleMessage' in tools);
    assert.ok(!('getCalendarEvents' in tools));
});
