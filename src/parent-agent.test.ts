import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
    PARENT_SKILLS,
    SKILL_POLICY,
    buildInvocationPrompt,
    createParentAgentRunner,
    createParentOptions,
    formatExecutionLogEvent,
    summarizeStreamEvent,
} from './parent-agent.js';
import type { AgentRegistry } from './agent-registry.js';
import { availableSkills } from './tool-policy.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function makeRegistry(): AgentRegistry {
    return {
        directories: ['/vault', '/shared'],
        parent: {
            id: 'parent',
            model: 'haiku',
            tools: [],
            systemPrompt: 'Parent instructions.',
        },
    };
}

function makeExecutionLogPath(): string {
    return resolve(mkdtempSync(resolve(tmpdir(), 'claude-librarian-test-')), 'execution.log');
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

test('createParentOptions uses native parent skills and disables subagent delegation', () => {
    const options = createParentOptions({
        registry: makeRegistry(),
        mcpServers: { calendar: { type: 'stdio' } },
    });

    assert.equal(options.agent, 'parent');
    // Only calendar-backed and built-in skills should remain active here.
    assert.deepEqual(options.allowedTools, [
        'Skill',
        'mcp__calendar__*',
        'Read',
        'Write',
        'Edit',
    ]);
    assert.equal(options.cwd, '/vault');
    assert.deepEqual(options.additionalDirectories, ['/shared']);
    assert.deepEqual(options.disallowedTools, ['Agent']);
    assert.deepEqual(options.settingSources, ['project']);
    assert.deepEqual(
        options.agents.parent.skills,
        availableSkills(SKILL_POLICY, { mcpServers: { calendar: { type: 'stdio' } } }),
    );
    assert.equal(options.agents.parent.prompt, 'Parent instructions.');
    assert.equal(options.agents.parent.tools, undefined);
    assert.equal(options.agents.parent.mcpServers, undefined);
    assert.deepEqual(options.tools, ['Skill', 'Read', 'Write', 'Edit']);
    assert.deepEqual(
        options.plugins.map((plugin) => plugin.path),
        [
            resolve(__dirname, '../plugins/caveman'),
            resolve(__dirname, '../plugins/parent-skills'),
        ],
    );
    assert.match(options.systemPrompt!, /Parent instructions\./);
    assert.doesNotMatch(options.systemPrompt!, /Loaded Skill: journal/);
});

test('createParentAgentRunner sends prompt through native-skilled parent without delegation', async () => {
    const calls: any[] = [];
    const queryFn = async function* ({ prompt, options }) {
        calls.push({ prompt, options });
        yield {
            type: 'result',
            subtype: 'success',
            result: 'Tomorrow looks busy.',
        };
    };

    const runParentAgent = createParentAgentRunner({
        registry: makeRegistry(),
        mcpServers: { calendar: { type: 'stdio' } },
        queryFn,
        executionLogPath: makeExecutionLogPath(),
    });

    const result = await runParentAgent({
        chatId: '42',
        prompt: 'What meetings do I have tomorrow afternoon?',
        source: 'telegram',
    });

    assert.equal(calls.length, 1);
    assert.match(calls[0].prompt, /source: telegram/);
    assert.match(calls[0].prompt, /What meetings do I have tomorrow afternoon\?/);
    assert.equal(calls[0].options.allowedTools.includes('Agent'), false);
    assert.deepEqual(calls[0].options.disallowedTools, ['Agent']);
    assert.ok(calls[0].options.allowedTools.includes('mcp__calendar__*'));
    assert.equal(calls[0].options.agent, 'parent');
    assert.deepEqual(
        calls[0].options.agents.parent.skills,
        availableSkills(SKILL_POLICY, { mcpServers: { calendar: { type: 'stdio' } } }),
    );
    assert.deepEqual(result.loadedSkills, availableSkills(SKILL_POLICY, { mcpServers: { calendar: { type: 'stdio' } } }));
    assert.equal(result.output, 'Tomorrow looks busy.');
});

test('createParentAgentRunner creates fresh SDK MCP servers for each invocation', async () => {
    const calls: any[] = [];
    let created = 0;
    const queryFn = async function* ({ options }) {
        calls.push(options.mcpServers.calendar);
        yield {
            type: 'result',
            subtype: 'success',
            result: 'Done.',
        };
    };

    const runParentAgent = createParentAgentRunner({
        registry: makeRegistry(),
        mcpServers: {
            calendar: () => ({
                type: 'sdk',
                name: 'calendar',
                instance: { id: ++created },
            }),
        },
        queryFn,
        executionLogPath: makeExecutionLogPath(),
    });

    await runParentAgent({ prompt: 'first', source: 'test' });
    await runParentAgent({ prompt: 'second', source: 'test' });

    assert.equal(created, 2);
    assert.notEqual(calls[0].instance, calls[1].instance);
});

test('createParentAgentRunner logs lifecycle timing around the query stream', async () => {
    const queryFn = async function* () {
        yield {
            type: 'assistant',
            message: {
                content: [{ type: 'text', text: 'Working...' }],
            },
        };
        yield {
            type: 'result',
            subtype: 'success',
            result: 'Done.',
        };
    };

    const runParentAgent = createParentAgentRunner({
        registry: makeRegistry(),
        mcpServers: { calendar: { type: 'stdio' } },
        queryFn,
        executionLogPath: makeExecutionLogPath(),
    });

    const calls: string[] = [];
    const originalConsoleLog = console.log;
    console.log = (...args) => calls.push(args.join(' '));

    try {
        await runParentAgent({
            chatId: '42',
            prompt: 'Move beer walk to start at 4:30',
            source: 'telegram',
        });
    } finally {
        console.log = originalConsoleLog;
    }

    assert.ok(calls.some((line) => line.includes('[claude] parent run started source=telegram chatId=42')));
    assert.ok(calls.some((line) => line.includes('[claude] preflight complete durationMs=')));
    assert.ok(calls.some((line) => line.includes('[claude] query started source=telegram chatId=42')));
    assert.ok(calls.some((line) => line.includes('[claude] first stream event afterMs=')));
    assert.ok(calls.some((line) => line.includes('[claude] parent run completed source=telegram chatId=42')));
});

test('createParentAgentRunner appends thoughts and stream details to an execution log file', async () => {
    const logPath = makeExecutionLogPath();
    const queryFn = async function* () {
        yield {
            type: 'assistant',
            message: {
                content: [
                    { type: 'thinking', thinking: 'Need to inspect the weekly note.' },
                    { type: 'tool_use', name: 'Read', input: { file_path: '/vault/week.md' } },
                ],
            },
        };
        yield {
            type: 'user',
            message: {
                content: [{ type: 'tool_result', content: 'Existing note contents.' }],
            },
        };
        yield {
            type: 'assistant',
            message: {
                content: [{ type: 'text', text: 'Logged.' }],
            },
        };
        yield {
            type: 'result',
            subtype: 'success',
            result: 'Logged.',
            duration_ms: 1234,
            total_cost_usd: 0.0123,
        };
    };

    const runParentAgent = createParentAgentRunner({
        registry: makeRegistry(),
        mcpServers: { calendar: { type: 'stdio' } },
        queryFn,
        executionLogPath: logPath,
    });

    try {
        await runParentAgent({
            chatId: '42',
            prompt: 'log that I felt focused today',
            source: 'telegram',
        });

        const log = readFileSync(logPath, 'utf8');
        assert.match(log, /parent run started source=telegram chatId=42/);
        assert.match(log, /assistant thinking:\nNeed to inspect the weekly note\./);
        assert.match(log, /tool use: Read\(\{"file_path":"\/vault\/week\.md"\}\)/);
        assert.match(log, /tool result:\nExisting note contents\./);
        assert.match(log, /assistant text:\nLogged\./);
        assert.match(log, /result:success costUsd=0\.0123 durationMs=1234/);
        assert.match(log, /parent run completed source=telegram chatId=42/);
    } finally {
        rmSync(dirname(logPath), { recursive: true, force: true });
    }
});

test('createParentOptions omits skills whose MCP servers are unavailable', () => {
    const options = createParentOptions({
        registry: makeRegistry(),
        mcpServers: { scheduler: { type: 'stdio' } },
    });

    assert.deepEqual(options.agents.parent.skills, ['journal', 'scheduler', 'task-review']);
    assert.deepEqual(options.allowedTools, [
        'Skill',
        'Read',
        'Write',
        'Edit',
        'mcp__scheduler__schedule_task',
        'mcp__scheduler__schedule_message',
        'mcp__scheduler__list_schedules',
        'mcp__scheduler__cancel_schedule',
    ]);
    assert.deepEqual(options.tools, ['Skill', 'Read', 'Write', 'Edit']);
});

test('parent skill plugin exposes every native skill with matching frontmatter', () => {
    const skillsRoot = resolve(__dirname, '../plugins/parent-skills/skills');

    for (const skill of PARENT_SKILLS) {
        const skillPath = resolve(skillsRoot, skill, 'SKILL.md');
        const body = readFileSync(skillPath, 'utf8');
        const frontmatter = body.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
        assert.ok(frontmatter, `${skill} should have YAML frontmatter`);
        assert.match(frontmatter[1]!, new RegExp(`^name: ${skill}$`, 'm'), `${skill} name should match directory`);
        assert.match(frontmatter[1]!, /^description: .+/m, `${skill} should have a description`);
        assert.match(frontmatter[1]!, /^tools:\n/m, `${skill} should declare a tools: list`);
        assert.ok(
            Array.isArray(SKILL_POLICY[skill]) && SKILL_POLICY[skill].length > 0,
            `${skill} tools list should be non-empty`,
        );
    }
});

test('summarizeStreamEvent formats common stream events for logging', () => {
    assert.equal(summarizeStreamEvent({ type: 'system', subtype: 'init' }), 'system:init');
    assert.equal(
        summarizeStreamEvent({ type: 'assistant', message: { content: [{ type: 'tool_use' }] } }),
        'assistant:tool_use',
    );
    assert.equal(summarizeStreamEvent({ type: 'result', subtype: 'success' }), 'result:success');
});

test('formatExecutionLogEvent formats thinking blocks for file logs', () => {
    assert.deepEqual(
        formatExecutionLogEvent({
            type: 'assistant',
            message: { content: [{ type: 'thinking', thinking: 'Check the task list.\nThen write.' }] },
        }),
        ['assistant thinking:\nCheck the task list.\nThen write.'],
    );
});

test('calendar skill and parent prompt allow calendar writes when tools are available', () => {
    const parentPrompt = readFileSync(resolve(__dirname, '../agents/parent/BOT.md'), 'utf8');
    const calendarSkill = readFileSync(resolve(__dirname, '../plugins/parent-skills/skills/calendar/SKILL.md'), 'utf8');

    assert.match(parentPrompt, /calendar event creation, updates, deletes/);
    assert.match(parentPrompt, /Do not claim calendar writes are unsupported unless/);
    assert.match(calendarSkill, /Create calendar events when the user asks/);
    assert.match(calendarSkill, /a second Skill invocation will not make them visible/);
    assert.match(calendarSkill, /no reminder/);
});
