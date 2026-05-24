import assert from 'node:assert/strict';
import test from 'node:test';
import { createComposioCalendarTools } from '../../src/mcp/composio-calendar.js';

test('createComposioCalendarTools returns empty object without an API key', async () => {
    const tools = await createComposioCalendarTools({});
    assert.deepEqual(tools, {});
});
