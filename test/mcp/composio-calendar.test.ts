import assert from 'node:assert/strict';
import test from 'node:test';
import { CALENDAR_TOOLS, createComposioCalendarTools } from '../../src/mcp/composio-calendar.js';

async function executeTool(tool: NonNullable<ReturnType<typeof createComposioCalendarTools>[number]>, args: Record<string, unknown>) {
    return (tool.execute as any)('call-1', args);
}

test('createComposioCalendarTools returns no tools without an API key', () => {
    assert.deepEqual(createComposioCalendarTools({}), []);
});

test('createComposioCalendarTools exposes expected Google Calendar tools', () => {
    const tools = createComposioCalendarTools({ apiKey: 'test-key', userId: 'user-1' }, async () => ({ ok: true }));
    const names = tools.map((tool) => tool.name);

    assert.equal(tools.length, CALENDAR_TOOLS.length);
    assert.ok(names.includes('mcp__composio__GOOGLECALENDAR_EVENTS_LIST_ALL_CALENDARS'));
    assert.ok(names.includes('mcp__composio__GOOGLECALENDAR_CREATE_EVENT'));
    assert.ok(names.includes('mcp__composio__GOOGLECALENDAR_DELETE_EVENT'));
});

test('Composio calendar tool executes the matching slug with wrapped arguments', async () => {
    const calls: Array<{ slug: string; args: Record<string, unknown> }> = [];
    const tools = createComposioCalendarTools({ apiKey: 'test-key', userId: 'user-1' }, async (slug, args) => {
        calls.push({ slug, args });
        return { ok: true };
    });

    const listAll = tools.find((tool) => tool.name === 'mcp__composio__GOOGLECALENDAR_EVENTS_LIST_ALL_CALENDARS');
    assert.ok(listAll);

    const result = await executeTool(listAll, {
        arguments: {
            time_min: '2026-05-24T00:00:00-07:00',
            time_max: '2026-05-31T23:59:59-07:00',
        },
    });

    assert.deepEqual(calls, [
        {
            slug: 'GOOGLECALENDAR_EVENTS_LIST_ALL_CALENDARS',
            args: {
                time_min: '2026-05-24T00:00:00-07:00',
                time_max: '2026-05-31T23:59:59-07:00',
            },
        },
    ]);
    assert.equal((result as any).isError, undefined);
    assert.match(result.content[0].text, /"ok": true/);
});

test('Composio calendar tool reports executor errors as tool errors', async () => {
    const tools = createComposioCalendarTools({ apiKey: 'test-key', userId: 'user-1' }, async () => {
        throw new Error('not connected');
    });

    const listAll = tools.find((tool) => tool.name === 'mcp__composio__GOOGLECALENDAR_EVENTS_LIST_ALL_CALENDARS');
    assert.ok(listAll);

    const result = await executeTool(listAll, {});

    assert.equal((result as any).isError, true);
    assert.match(result.content[0].text, /not connected/);
});
