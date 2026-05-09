import assert from 'node:assert/strict';
import test from 'node:test';
import { availableSkills, parseToolsFromFrontmatter, toolsForSkills, type SkillPolicy } from './tool-policy.js';

const MOCK_TOOLS_BY_SKILL: SkillPolicy = {
    journal: ['Read', 'Write', 'Edit'],
    'task-review': ['Read'],
    calendar: ['mcp__calendar__*'],
};

test('toolsForSkills scopes tools to selected skills', () => {
    assert.deepEqual(toolsForSkills(['journal'], MOCK_TOOLS_BY_SKILL), ['Skill', 'Read', 'Write', 'Edit']);
    assert.deepEqual(toolsForSkills(['calendar'], MOCK_TOOLS_BY_SKILL), ['Skill', 'mcp__calendar__*']);
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

test('availableSkills keeps MCP-backed skills when their server is configured', () => {
    assert.deepEqual(
        availableSkills(MOCK_TOOLS_BY_SKILL, { mcpServers: { calendar: { type: 'stdio' } } }),
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
