import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
    buildInvocationPrompt,
    createParentAgentRunner,
} from '../src/parent-agent.js';
import type { ParentConfig } from '../src/parent-agent.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function makeParent(): ParentConfig {
    return {
        id: 'parent',
        name: 'parent',
        description: 'Telegram-facing parent assistant',
        model: 'sonnet',
        tools: [],
        directories: [],
        systemPrompt: 'Parent instructions.',
    };
}

test('buildInvocationPrompt includes source metadata', () => {
    const prompt = buildInvocationPrompt({
        chatId: '42',
        jobName: 'daily-rollover',
        prompt: 'Body prompt',
        source: 'job',
    });

    assert.match(prompt, /\[Invocation metadata\]/);
    assert.match(prompt, /source: job/);
    assert.match(prompt, /job_name: daily-rollover/);
    assert.match(prompt, /chat_id: 42/);
    assert.match(prompt, /Body prompt/);
});

test('parent skill plugin exposes every skill with valid frontmatter and domain-native tool names', () => {
    const skillsRoot = resolve(__dirname, '../plugins/parent-skills/skills');
    const skillDirs = readdirSync(skillsRoot, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name);

    const allowedTools = new Set([
        'readFile', 'writeFile', 'bash',
        'scheduleTask', 'scheduleMessage', 'listSchedules', 'cancelSchedule',
        'getCalendarEvents', 'listCalendars', 'listCalendarEvents',
        'createCalendarEvent', 'updateCalendarEvent', 'deleteCalendarEvent',
        'findCalendarEvent', 'findCalendarFreeSlots',
    ]);

    for (const skill of skillDirs) {
        const skillPath = resolve(skillsRoot, skill, 'SKILL.md');
        const body = readFileSync(skillPath, 'utf8');
        const frontmatter = body.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
        assert.ok(frontmatter, `${skill} should have YAML frontmatter`);
        assert.match(frontmatter[1]!, new RegExp(`^name: ${skill}$`, 'm'), `${skill} name should match directory`);
        assert.match(frontmatter[1]!, /^description: .+/m, `${skill} should have a description`);
        assert.match(frontmatter[1]!, /^tools:\r?\n/m, `${skill} should declare a tools: list`);

        const toolLines = (frontmatter[1]!.match(/^  - (.+)$/gm) ?? frontmatter[1]!.match(/^    - (.+)$/gm) ?? []);
        for (const line of toolLines) {
            const toolName = line.replace(/^\s+- /, '').trim();
            assert.ok(
                allowedTools.has(toolName),
                `${skill} uses unknown tool name "${toolName}" — should be a domain-native name`,
            );
        }
    }
});

test('calendar skill documents domain-native tool names', () => {
    const calendarSkill = readFileSync(resolve(__dirname, '../plugins/parent-skills/skills/calendar/SKILL.md'), 'utf8');

    assert.match(calendarSkill, /createCalendarEvent/);
    assert.match(calendarSkill, /Create calendar events when the user asks/);
});

test('scheduler skill documents domain-native tool names', () => {
    const schedulerSkill = readFileSync(resolve(__dirname, '../plugins/parent-skills/skills/scheduler/SKILL.md'), 'utf8');

    assert.match(schedulerSkill, /scheduleTask/);
    assert.match(schedulerSkill, /scheduleMessage/);
    assert.match(schedulerSkill, /listSchedules/);
    assert.match(schedulerSkill, /cancelSchedule/);
});
