import assert from 'node:assert/strict';
import test from 'node:test';
import { CALENDAR_TOOL_SPECS, createComposioCalendarTools } from '../../src/mcp/composio-calendar.js';

test('createComposioCalendarTools returns empty object without an API key', () => {
    assert.deepEqual(createComposioCalendarTools({}), {});
});

test('createComposioCalendarTools exposes expected Google Calendar tools', () => {
    const tools = createComposioCalendarTools({ apiKey: 'test-key', userId: 'user-1' }, async () => ({ ok: true }));
    const names = Object.keys(tools);

    assert.equal(names.length, CALENDAR_TOOL_SPECS.length);
    assert.ok(names.includes('getCalendarEvents'));
    assert.ok(names.includes('createCalendarEvent'));
    assert.ok(names.includes('deleteCalendarEvent'));
    assert.ok(names.includes('listCalendars'));
});

test('Composio calendar tool executes the matching slug with arguments', async () => {
    const calls: Array<{ slug: string; args: Record<string, unknown> }> = [];
    const tools = createComposioCalendarTools({ apiKey: 'test-key', userId: 'user-1' }, async (slug, args) => {
        calls.push({ slug, args });
        return { ok: true };
    });

    const getEvents = tools['getCalendarEvents'];
    assert.ok(getEvents?.execute);

    await getEvents.execute!({
        arguments: {
            time_min: '2026-05-24T00:00:00-07:00',
            time_max: '2026-05-31T23:59:59-07:00',
        },
    } as any, { toolCallId: 'call-1', messages: [] });

    assert.deepEqual(calls, [
        {
            slug: 'GOOGLECALENDAR_EVENTS_LIST_ALL_CALENDARS',
            args: {
                time_min: '2026-05-24T00:00:00-07:00',
                time_max: '2026-05-31T23:59:59-07:00',
            },
        },
    ]);
});

test('Composio calendar tool returns error on executor failure', async () => {
    const tools = createComposioCalendarTools({ apiKey: 'test-key', userId: 'user-1' }, async () => {
        throw new Error('not connected');
    });

    const getEvents = tools['getCalendarEvents'];
    assert.ok(getEvents?.execute);

    const result = await getEvents.execute!({} as any, { toolCallId: 'call-1', messages: [] });
    assert.ok(result && typeof result === 'object' && 'error' in result);
    assert.match(String((result as any).error), /not connected/);
});
