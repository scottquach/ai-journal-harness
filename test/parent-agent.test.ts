import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
    PARENT_BASE_TOOLS,
    buildInvocationPrompt,
    createParentAgentRunner,
    formatExecutionLogEvent,
} from '../src/parent-agent.js';
import type { ParentConfig, ParentSessionFactory } from '../src/parent-agent.js';
import type { ToolDefinition } from '@earendil-works/pi-coding-agent';

const __dirname = dirname(fileURLToPath(import.meta.url));

function makeParent(): ParentConfig {
    return {
        id: 'parent',
        name: 'parent',
        description: 'Telegram-facing parent assistant',
        model: 'sonnet',
        tools: [],
        directories: ['/vault', '/shared'],
        systemPrompt: 'Parent instructions.',
    };
}

function makeExecutionLogPath(): string {
    return resolve(mkdtempSync(resolve(tmpdir(), 'claude-librarian-test-')), 'execution.log');
}

function tool(name: string): ToolDefinition {
    return { name } as ToolDefinition;
}

function makeSessionFactory(calls: any[], outputs: string[] = ['ok']): ParentSessionFactory {
    let sessionCount = 0;
    return async (parent, tools) => {
        calls.push({ type: 'createSession', parent, tools });
        const sessionId = ++sessionCount;
        const prompts: string[] = [];
        let disposed = false;
        return {
            async prompt(text: string) {
                calls.push({ type: 'prompt', sessionId, text });
                prompts.push(text);
            },
            subscribe(listener: any) {
                calls.push({ type: 'subscribe', sessionId });
                listener({ type: 'agent_start' });
                return () => calls.push({ type: 'unsubscribe', sessionId });
            },
            getLastAssistantText() {
                return outputs[prompts.length - 1] ?? outputs.at(-1) ?? '';
            },
            dispose() {
                disposed = true;
                calls.push({ type: 'dispose', sessionId, disposed });
            },
        };
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

test('PARENT_BASE_TOOLS includes all pi native file tools', () => {
    assert.ok(PARENT_BASE_TOOLS.includes('read'));
    assert.ok(PARENT_BASE_TOOLS.includes('write'));
    assert.ok(PARENT_BASE_TOOLS.includes('edit'));
    assert.ok(PARENT_BASE_TOOLS.includes('grep'));
    assert.ok(PARENT_BASE_TOOLS.includes('find'));
    assert.ok(PARENT_BASE_TOOLS.includes('ls'));
});

test('createParentAgentRunner sends prompt through Pi session factory', async () => {
    const calls: any[] = [];
    const logPath = makeExecutionLogPath();
    const runParentAgent = createParentAgentRunner({
        parent: makeParent(),
        tools: [tool('mcp__calendar__get_calendar_events')],
        sessionFactory: makeSessionFactory(calls, ['Tomorrow looks busy.']),
        executionLogPath: logPath,
    });

    try {
        const result = await runParentAgent({
            chatId: '42',
            prompt: 'What meetings do I have tomorrow afternoon?',
            source: 'telegram',
        });

        const promptCall = calls.find((call) => call.type === 'prompt');
        assert.match(promptCall.text, /source: telegram/);
        assert.match(promptCall.text, /What meetings do I have tomorrow afternoon\?/);
        const createCall = calls.find((c) => c.type === 'createSession');
        assert.ok(createCall.tools.some((t: ToolDefinition) => t.name === 'mcp__calendar__get_calendar_events'));
        assert.equal(result.output, 'Tomorrow looks busy.');

        const log = readFileSync(logPath, 'utf8');
        assert.match(log, /parent run started source=telegram chatId=42/);
        assert.match(log, /query started source=telegram chatId=42/);
        assert.match(log, /parent run completed source=telegram chatId=42/);
    } finally {
        rmSync(dirname(logPath), { recursive: true, force: true });
    }
});

test('createParentAgentRunner prepends date context to every prompt', async () => {
    const calls: any[] = [];
    const runParentAgent = createParentAgentRunner({
        parent: makeParent(),
        sessionFactory: makeSessionFactory(calls),
        executionLogPath: makeExecutionLogPath(),
    });

    await runParentAgent({ prompt: 'hello', source: 'job' });

    const promptCall = calls.find((c) => c.type === 'prompt');
    assert.match(promptCall.text, /\[Context: today is \d{4}-\d{2}-\d{2}/);
});

test('createParentAgentRunner reuses a Pi session for Telegram turns in the same chat', async () => {
    const calls: any[] = [];
    const runParentAgent = createParentAgentRunner({
        parent: makeParent(),
        sessionFactory: makeSessionFactory(calls, ['reply-1', 'reply-2']),
        executionLogPath: makeExecutionLogPath(),
    });

    const first = await runParentAgent({ chatId: '42', prompt: 'first', source: 'telegram' });
    const second = await runParentAgent({ chatId: '42', prompt: 'second', source: 'telegram' });

    assert.equal(calls.filter((call) => call.type === 'createSession').length, 1);
    assert.equal(calls.filter((call) => call.type === 'prompt').length, 2);
    assert.equal(first.output, 'reply-1');
    assert.equal(second.output, 'reply-2');
});

test('createParentAgentRunner isolates Telegram sessions by chatId', async () => {
    const calls: any[] = [];
    const runParentAgent = createParentAgentRunner({
        parent: makeParent(),
        sessionFactory: makeSessionFactory(calls, ['reply']),
        executionLogPath: makeExecutionLogPath(),
    });

    await runParentAgent({ chatId: '42', prompt: 'hi', source: 'telegram' });
    await runParentAgent({ chatId: '99', prompt: 'hi', source: 'telegram' });

    assert.equal(calls.filter((call) => call.type === 'createSession').length, 2);
});

test('createParentAgentRunner disposes one-shot sessions', async () => {
    const calls: any[] = [];
    const runParentAgent = createParentAgentRunner({
        parent: makeParent(),
        sessionFactory: makeSessionFactory(calls),
        executionLogPath: makeExecutionLogPath(),
    });

    await runParentAgent({ prompt: 'one shot', source: 'job' });

    assert.equal(calls.some((call) => call.type === 'dispose'), true);
});

test('parent skill plugin exposes every skill with valid frontmatter and pi-native tool names', () => {
    const skillsRoot = resolve(__dirname, '../plugins/parent-skills/skills');
    const skillDirs = readdirSync(skillsRoot, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name);

    const piBuiltinTools = new Set(['read', 'write', 'edit', 'grep', 'find', 'ls', 'bash']);

    for (const skill of skillDirs) {
        const skillPath = resolve(skillsRoot, skill, 'SKILL.md');
        const body = readFileSync(skillPath, 'utf8');
        const frontmatter = body.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
        assert.ok(frontmatter, `${skill} should have YAML frontmatter`);
        assert.match(frontmatter[1]!, new RegExp(`^name: ${skill}$`, 'm'), `${skill} name should match directory`);
        assert.match(frontmatter[1]!, /^description: .+/m, `${skill} should have a description`);
        assert.match(frontmatter[1]!, /^tools:\r?\n/m, `${skill} should declare a tools: list`);

        const toolLines = frontmatter[1]!.match(/^  - (.+)$/gm) ?? frontmatter[1]!.match(/^    - (.+)$/gm) ?? [];
        for (const line of toolLines) {
            const toolName = line.replace(/^\s+- /, '').trim();
            if (!toolName.startsWith('mcp__')) {
                assert.ok(
                    piBuiltinTools.has(toolName),
                    `${skill} uses non-pi tool name "${toolName}" — should be lowercase pi name`,
                );
            }
        }
    }
});

test('formatExecutionLogEvent formats Pi stream events', () => {
    assert.deepEqual(
        formatExecutionLogEvent({
            type: 'message_update',
            assistantMessageEvent: { type: 'text_delta', delta: 'Logged.' },
        } as any),
        ['assistant text delta:\nLogged.'],
    );
    assert.deepEqual(
        formatExecutionLogEvent({ type: 'tool_execution_start', toolName: 'read' } as any),
        ['tool use: read'],
    );
    assert.deepEqual(
        formatExecutionLogEvent({ type: 'agent_end', messages: [], willRetry: false } as any),
        ['result:success'],
    );
});

test('calendar skill still documents read-only fallback and Composio write behavior', () => {
    const calendarSkill = readFileSync(resolve(__dirname, '../plugins/parent-skills/skills/calendar/SKILL.md'), 'utf8');

    assert.match(calendarSkill, /Create calendar events when the user asks/);
    assert.match(calendarSkill, /mcp__composio__GOOGLECALENDAR_CREATE_EVENT/);
});
