import assert from 'node:assert/strict';
import test from 'node:test';
import { availableSkills, parseToolsFromFrontmatter, toolsForSkills, type SkillPolicy } from '../src/tool-policy.js';

const MOCK_TOOLS_BY_SKILL: SkillPolicy = {
    journal: ['Read', 'Write', 'Edit'],
    'task-review': ['Read'],
    calendar: ['mcp__composio__GOOGLECALENDAR_*', 'mcp__calendar__get_calendar_events'],
};

test('toolsForSkills scopes tools to selected skills', () => {
    assert.deepEqual(toolsForSkills(['journal'], MOCK_TOOLS_BY_SKILL), ['Skill', 'Read', 'Write', 'Edit']);
    assert.deepEqual(
        toolsForSkills(['calendar'], MOCK_TOOLS_BY_SKILL),
        ['Skill', 'mcp__composio__GOOGLECALENDAR_*', 'mcp__calendar__get_calendar_events'],
    );
});

test('toolsForSkills filters MCP grants to configured servers when provided', () => {
    assert.deepEqual(
        toolsForSkills(['calendar'], MOCK_TOOLS_BY_SKILL, { mcpServers: { composio: { type: 'http' } } }),
        ['Skill', 'mcp__composio__GOOGLECALENDAR_*'],
    );
    assert.deepEqual(
        toolsForSkills(['calendar'], MOCK_TOOLS_BY_SKILL, { mcpServers: { calendar: { type: 'stdio' } } }),
        ['Skill', 'mcp__calendar__get_calendar_events'],
    );
});

test('toolsForSkills de-duplicates overlapping tools', () => {
    assert.deepEqual(
        toolsForSkills(['journal', 'task-review'], MOCK_TOOLS_BY_SKILL),
        ['Skill', 'Read', 'Write', 'Edit'],
    );
});

test('availableSkills omits MCP-backed skills when their server is not configured', () => {
    assert.deepEqual(
        availableSkills(MOCK_TOOLS_BY_SKILL, { mcpServers: {} }),
        ['journal', 'task-review'],
    );
});

test('availableSkills keeps MCP-backed skills when any referenced server is configured', () => {
    assert.deepEqual(
        availableSkills(MOCK_TOOLS_BY_SKILL, { mcpServers: { calendar: { type: 'stdio' } } }),
        ['journal', 'task-review', 'calendar'],
    );
    assert.deepEqual(
        availableSkills(MOCK_TOOLS_BY_SKILL, { mcpServers: { composio: { type: 'http' } } }),
        ['journal', 'task-review', 'calendar'],
    );
});

test('parseToolsFromFrontmatter extracts tools list from SKILL.md content', () => {
    const content = `---
name: example
description: An example skill.
tools:
  - Read
  - mcp__foo__*
---

# Body
`;
    assert.deepEqual(parseToolsFromFrontmatter(content), ['Read', 'mcp__foo__*']);
});

test('parseToolsFromFrontmatter returns empty array when tools field is absent', () => {
    const content = `---
name: example
description: No tools here.
---

# Body
`;
    assert.deepEqual(parseToolsFromFrontmatter(content), []);
});

test('parseToolsFromFrontmatter returns empty array when frontmatter is missing', () => {
    assert.deepEqual(parseToolsFromFrontmatter('# Just a body, no frontmatter\n'), []);
});
