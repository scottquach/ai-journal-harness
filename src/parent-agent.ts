import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { appendFileSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { query } from '@anthropic-ai/claude-agent-sdk';
import type { BotConfig } from './bot-config-loader.js';
import { availableSkills, parseToolsFromFrontmatter, toolsForSkills } from './tool-policy.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pluginPath = resolve(__dirname, '../plugins/caveman');
const parentSkillsPluginPath = resolve(__dirname, '../plugins/parent-skills');

type McpServerConfig = unknown;
type McpServerFactory = () => McpServerConfig;
type McpServerEntry = McpServerConfig | McpServerFactory;
type McpServers = Record<string, McpServerEntry>;

type ParentInvocationInput = {
    prompt?: string;
    source?: string;
    jobName?: string;
    chatId?: string;
};

type ParentInvocationResult = {
    loadedSkills: string[];
    output: string;
};

type ParentRunner = (input?: ParentInvocationInput) => Promise<ParentInvocationResult>;

type ParentConfig = BotConfig & {
    id: string;
};

type ParentOptionsInput = {
    parent: ParentConfig;
    mcpServers?: McpServers;
};

type ExecutionLogger = {
    path: string;
    write: (message: string) => void;
    writeEvent: (event: any) => void;
};

type ParentAgentOptions = {
    pathToClaudeCodeExecutable: string;
    env: NodeJS.ProcessEnv;
    cwd: string;
    additionalDirectories: string[];
    agent: string;
    agents: Record<string, {
        description: string;
        model: string;
        prompt: string;
        skills: string[];
        tools?: string[];
        mcpServers?: McpServers;
    }>;
    allowedTools: string[];
    tools: string[];
    allowDangerouslySkipPermissions: boolean;
    disallowedTools: string[];
    includePartialMessages: boolean;
    mcpServers?: McpServers;
    model: string;
    permissionMode: string;
    plugins: Array<{ type: 'local'; path: string }>;
    settingSources: string[];
    systemPrompt?: string;
};

type QueryFn = (input: { prompt: string | AsyncIterable<any>; options: ParentAgentOptions }) => AsyncIterable<any>;

type ParentRunnerFactoryInput = ParentOptionsInput & {
    queryFn?: QueryFn;
    executionLogPath?: string;
};

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function getErrorStack(error: unknown): string {
    return error instanceof Error ? error.stack ?? '' : '';
}

function discoverSkillPolicy(pluginPath: string): Record<string, string[]> {
    const skillsDir = resolve(pluginPath, 'skills');
    const dirs = readdirSync(skillsDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .sort((a, b) => a.name.localeCompare(b.name));

    const policy: Record<string, string[]> = {};
    for (const dir of dirs) {
        const content = readFileSync(resolve(skillsDir, dir.name, 'SKILL.md'), 'utf8');
        policy[dir.name] = parseToolsFromFrontmatter(content);
    }
    return policy;
}

const SKILL_POLICY = discoverSkillPolicy(parentSkillsPluginPath);
const PARENT_SKILLS = Object.freeze(Object.keys(SKILL_POLICY));
const PARENT_BASE_TOOLS = Object.freeze(['Read', 'Glob', 'Grep', 'LS']);

const c = {
    reset: '\x1b[0m',
    dim: '\x1b[2m',
    cyan: '\x1b[36m',
    yellow: '\x1b[33m',
    green: '\x1b[32m',
};

function normalizeLogText(value: string): string {
    return value.endsWith('\n') ? value.slice(0, -1) : value;
}

function formatExecutionLogEvent(event: any): string[] {
    const type = event.type;

    if (type === 'system') {
        if (event.subtype !== 'init') return [`system:${event.subtype ?? 'unknown'}`];

        const lines = ['system:init'];
        for (const server of event.mcp_servers ?? []) {
            lines.push(`mcp ${server.name}: ${server.status}`);
        }
        const mcpTools = (event.tools ?? []).filter((t: string) => t.startsWith('mcp__'));
        lines.push(`mcp tools: ${mcpTools.join(', ') || 'none registered'}`);
        return lines;
    }

    if (type === 'assistant') {
        const lines: string[] = [];
        const blocks = event.message?.content ?? [];
        for (const block of blocks) {
            if (block.type === 'text' && block.text) {
                lines.push(`assistant text:\n${normalizeLogText(block.text)}`);
            } else if (block.type === 'thinking' && block.thinking) {
                lines.push(`assistant thinking:\n${normalizeLogText(block.thinking)}`);
            } else if (block.type === 'tool_use') {
                lines.push(`tool use: ${block.name}(${JSON.stringify(block.input ?? {})})`);
            }
        }
        return lines;
    }

    if (type === 'tool_result' || (type === 'user' && event.message?.content?.[0]?.type === 'tool_result')) {
        const results = type === 'tool_result' ? [event] : event.message.content;
        return results.map((result: any) => {
            const content = Array.isArray(result.content)
                ? result.content.map((item: any) => item.text ?? '').join('')
                : (result.content ?? '');
            return `tool result:\n${normalizeLogText(String(content))}`;
        });
    }

    if (type === 'result') {
        const cost = event.total_cost_usd != null ? ` costUsd=${event.total_cost_usd.toFixed(4)}` : '';
        const duration = event.duration_ms != null ? ` durationMs=${event.duration_ms}` : '';
        return [`result:${event.subtype ?? 'unknown'}${cost}${duration}`];
    }

    return [type ?? 'unknown'];
}

function createExecutionLogger(logPath: string, runId: string): ExecutionLogger {
    mkdirSync(dirname(logPath), { recursive: true });

    return {
        path: logPath,
        write(message: string) {
            const timestamp = new Date().toISOString();
            appendFileSync(logPath, `[${timestamp}] [${runId}] ${message}\n`, 'utf8');
        },
        writeEvent(event: any) {
            for (const line of formatExecutionLogEvent(event)) {
                this.write(line);
            }
        },
    };
}

function logStreamEvent(event: any, executionLogger?: ExecutionLogger): void {
    executionLogger?.writeEvent(event);

    const type = event.type;

    if (type === 'system') {
        if (event.subtype === 'init') {
            for (const server of event.mcp_servers ?? []) {
                const ok = server.status === 'connected';
                const color = ok ? c.green : c.yellow;
                process.stdout.write(`${color}[mcp] ${server.name}: ${server.status}${c.reset}\n`);
            }
            const mcpTools = (event.tools ?? []).filter((t: string) => t.startsWith('mcp__'));
            if (mcpTools.length > 0) {
                process.stdout.write(`${c.dim}[mcp tools] ${mcpTools.join(', ')}${c.reset}\n`);
            } else {
                process.stdout.write(`${c.yellow}[mcp tools] none registered${c.reset}\n`);
            }
        }
        return;
    }

    if (type === 'assistant') {
        const blocks = event.message?.content ?? [];
        for (const block of blocks) {
            if (block.type === 'text' && block.text) {
                process.stdout.write(`${c.reset}${block.text}`);
            } else if (block.type === 'thinking' && block.thinking) {
                process.stdout.write(`${c.dim}[thinking] ${block.thinking}${c.reset}\n`);
            } else if (block.type === 'tool_use') {
                const input = JSON.stringify(block.input ?? {});
                process.stdout.write(`${c.cyan}[tool] ${block.name}(${input})${c.reset}\n`);
            }
        }
    } else if (type === 'tool_result' || (type === 'user' && event.message?.content?.[0]?.type === 'tool_result')) {
        const results = type === 'tool_result' ? [event] : event.message.content;
        for (const result of results) {
            const content = Array.isArray(result.content)
                ? result.content.map((item) => item.text ?? '').join('')
                : (result.content ?? '');
            const preview = content.slice(0, 120).replace(/\n/g, ' ');
            process.stdout.write(`${c.yellow}[result] ${preview}${content.length > 120 ? '…' : ''}${c.reset}\n`);
        }
    } else if (type === 'result') {
        const cost = event.total_cost_usd != null ? ` $${event.total_cost_usd.toFixed(4)}` : '';
        const duration = event.duration_ms != null ? ` ${(event.duration_ms / 1000).toFixed(1)}s` : '';
        process.stdout.write(`\n${c.green}[done]${cost}${duration}${c.reset}\n`);
    }
}

function buildInvocationPrompt({ prompt = '', source = 'unknown', jobName, chatId }: ParentInvocationInput): string {
    const lines = ['[Invocation metadata]', `source: ${source}`];

    if (jobName) lines.push(`job_name: ${jobName}`);
    if (chatId) lines.push(`chat_id: ${chatId}`);

    lines.push('[/Invocation metadata]', '', prompt);
    return lines.join('\n');
}

function resolveMcpServers(mcpServers?: McpServers): Record<string, McpServerConfig> | undefined {
    if (!mcpServers) return undefined;

    const resolved: Record<string, McpServerConfig> = {};
    for (const [name, server] of Object.entries(mcpServers)) {
        resolved[name] = typeof server === 'function' ? server() : server;
    }
    return resolved;
}

function createParentOptions({ parent, mcpServers }: ParentOptionsInput): ParentAgentOptions {
    const resolvedMcpServers = resolveMcpServers(mcpServers);
    const activeSkills = availableSkills(SKILL_POLICY, { mcpServers: resolvedMcpServers });
    const allowedTools = toolsForSkills(activeSkills, SKILL_POLICY, {
        baseTools: [...PARENT_BASE_TOOLS],
        mcpServers: resolvedMcpServers,
    });
    const builtInTools = allowedTools.filter((toolName) => !toolName.startsWith('mcp__'));

    return {
        pathToClaudeCodeExecutable: process.env.CLAUDE_PATH ?? 'claude',
        env: process.env,
        cwd: parent.directories[0],
        additionalDirectories: parent.directories.slice(1),
        agent: parent.id,
        agents: {
            [parent.id]: {
                description: parent.description ?? 'Telegram-facing parent assistant',
                model: parent.model,
                prompt: parent.systemPrompt,
                skills: [...activeSkills],
            },
        },
        allowedTools,
        tools: builtInTools,
        allowDangerouslySkipPermissions: false,
        disallowedTools: ['Agent'],
        includePartialMessages: true,
        mcpServers: resolvedMcpServers,
        model: parent.model,
        permissionMode: 'acceptEdits',
        plugins: [
            { type: 'local', path: pluginPath },
            { type: 'local', path: parentSkillsPluginPath },
        ],
        settingSources: ['project'],
        systemPrompt: parent.systemPrompt || undefined,
    };
}

function checkClaudeExecutable(claudePath: string): Promise<void> {
    return new Promise<void>((resolve) => {
        execFile(claudePath, ['--version'], { timeout: 5000 }, (err, stdout, stderr) => {
            if (err) {
                console.error(`[claude] preflight check failed for "${claudePath}":`, err.message);
                if (stderr) console.error('[claude] preflight stderr:', stderr);
            } else {
                console.log(`[claude] preflight ok: ${stdout.trim()}`);
            }
            resolve();
        });
    });
}

let claudePreflightPromise: Promise<void> | null = null;

function ensureClaudeExecutableCheck(claudePath: string): Promise<void> {
    claudePreflightPromise ??= checkClaudeExecutable(claudePath);
    return claudePreflightPromise;
}

function summarizeStreamEvent(message: any): string {
    if (message.type === 'result') return `result:${message.subtype ?? 'unknown'}`;
    if (message.type === 'system') return `system:${message.subtype ?? 'unknown'}`;
    if (message.type === 'assistant') return `assistant:${message.message?.content?.[0]?.type ?? 'content'}`;
    if (message.type === 'tool_result') return 'tool_result';
    if (message.type === 'user') return `user:${message.message?.content?.[0]?.type ?? 'content'}`;
    return message.type ?? 'unknown';
}

type InputChannel<T> = {
    push: (msg: T) => void;
    close: () => void;
    iterable: AsyncIterable<T>;
};

function createInputChannel<T>(): InputChannel<T> {
    const buf: T[] = [];
    const waiters: Array<(v: IteratorResult<T>) => void> = [];
    let closed = false;

    const push = (msg: T) => {
        if (closed) return;
        const waiter = waiters.shift();
        if (waiter) waiter({ value: msg, done: false });
        else buf.push(msg);
    };

    const close = () => {
        if (closed) return;
        closed = true;
        while (waiters.length) waiters.shift()!({ value: undefined as unknown as T, done: true });
    };

    const iterable: AsyncIterable<T> = {
        [Symbol.asyncIterator]() {
            return {
                next() {
                    if (buf.length) return Promise.resolve({ value: buf.shift()!, done: false });
                    if (closed) return Promise.resolve({ value: undefined as unknown as T, done: true });
                    return new Promise<IteratorResult<T>>((r) => waiters.push(r));
                },
                return() {
                    close();
                    return Promise.resolve({ value: undefined as unknown as T, done: true });
                },
            };
        },
    };

    return { push, close, iterable };
}

type PendingTurn = {
    resolve: (output: string) => void;
    reject: (err: Error) => void;
    executionLogger: ExecutionLogger;
};

type Session = {
    sessionId: string;
    channel: InputChannel<any>;
    loadedSkills: string[];
    pendingTurn: PendingTurn | null;
    mutex: Promise<void>;
    dead: boolean;
};

function createSession(
    queryImpl: QueryFn,
    options: ParentAgentOptions,
    initialLogger: ExecutionLogger,
): Session {
    const channel = createInputChannel<any>();
    const loadedSkills = options.agents[options.agent].skills;
    const session: Session = {
        sessionId: randomUUID(),
        channel,
        loadedSkills,
        pendingTurn: null,
        mutex: Promise.resolve(),
        dead: false,
    };

    const iter = queryImpl({ prompt: channel.iterable, options });

    (async () => {
        try {
            for await (const message of iter as AsyncIterable<any>) {
                logStreamEvent(message, session.pendingTurn?.executionLogger ?? initialLogger);
                if (message.type === 'result') {
                    const turn = session.pendingTurn;
                    session.pendingTurn = null;
                    if (!turn) continue;
                    if (message.subtype === 'success') {
                        turn.resolve(message.result ?? '');
                    } else {
                        const errorMsg = message.errors?.join('; ') ?? `Claude ended with subtype: ${message.subtype}`;
                        turn.reject(new Error(errorMsg));
                    }
                }
            }
        } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            console.error(`[claude] session loop error: ${err.message}`, getErrorStack(err));
            session.pendingTurn?.reject(err);
            session.pendingTurn = null;
        } finally {
            session.dead = true;
            channel.close();
        }
    })();

    return session;
}

async function runOnSession(
    session: Session,
    promptText: string,
    executionLogger: ExecutionLogger,
): Promise<string> {
    if (session.dead) throw new Error('session is dead');

    const prev = session.mutex;
    let release!: () => void;
    session.mutex = new Promise<void>((r) => { release = r; });
    await prev;

    try {
        if (session.dead) throw new Error('session died before turn could start');
        return await new Promise<string>((resolve, reject) => {
            session.pendingTurn = { resolve, reject, executionLogger };
            session.channel.push({
                type: 'user',
                message: { role: 'user', content: promptText },
                parent_tool_use_id: null,
                session_id: session.sessionId,
            });
        });
    } finally {
        release();
    }
}

async function runOneShot(
    queryImpl: QueryFn,
    options: ParentAgentOptions,
    promptText: string,
    executionLogger: ExecutionLogger,
    onFirstEvent: (event: any) => void,
): Promise<string> {
    let result: string | null = null;
    let firstEventSeen = false;

    for await (const message of queryImpl({ prompt: promptText, options }) as AsyncIterable<any>) {
        if (!firstEventSeen) {
            firstEventSeen = true;
            onFirstEvent(message);
        }
        logStreamEvent(message, executionLogger);
        if (message.type === 'result') {
            if (message.subtype === 'success') {
                result = message.result ?? '';
                continue;
            }
            const errorMsg = message.errors?.join('; ') ?? `Claude ended with subtype: ${message.subtype}`;
            console.error('[claude] result event failure:', JSON.stringify(message, null, 2));
            throw new Error(errorMsg);
        }
    }

    return result ?? '';
}

function shouldPersistSession(source: string | undefined, chatId: string | undefined): boolean {
    return source === 'telegram' && !!chatId;
}

function createParentAgentRunner({ parent, mcpServers, queryFn, executionLogPath }: ParentRunnerFactoryInput): ParentRunner {
    const claudePath = process.env.CLAUDE_PATH ?? 'claude';
    const queryImpl: QueryFn = queryFn ?? (query as unknown as QueryFn);
    const logPath = executionLogPath ?? process.env.CLAUDE_EXECUTION_LOG_PATH ?? resolve(__dirname, '../logs/execution.log');
    const sessionsByChatId = new Map<string, Session>();

    function getOrCreateSession(chatId: string, executionLogger: ExecutionLogger): Session {
        let session = sessionsByChatId.get(chatId);
        if (session && !session.dead) return session;

        const options = createParentOptions({ parent, mcpServers });
        session = createSession(queryImpl, options, executionLogger);
        sessionsByChatId.set(chatId, session);
        return session;
    }

    return async function runParentAgent({ prompt = '', source, jobName, chatId } = {}) {
        const startedAt = Date.now();
        const runId = randomUUID();
        const executionLogger = createExecutionLogger(logPath, runId);
        executionLogger.write(
            `parent run started source=${source ?? 'unknown'} chatId=${chatId ?? 'n/a'} jobName=${jobName ?? 'n/a'}`,
        );
        console.log(
            `[claude] parent run started source=${source ?? 'unknown'} chatId=${chatId ?? 'n/a'} jobName=${jobName ?? 'n/a'}`,
        );

        await ensureClaudeExecutableCheck(claudePath);
        console.log(`[claude] preflight complete durationMs=${Date.now() - startedAt}`);

        const finalPrompt = buildInvocationPrompt({ chatId, jobName, prompt, source });

        const persist = shouldPersistSession(source, chatId);
        let result: string;
        let loadedSkills: string[];

        if (persist) {
            const session = getOrCreateSession(chatId!, executionLogger);
            loadedSkills = session.loadedSkills;

            console.log(
                `[claude] query started source=${source} chatId=${chatId} jobName=${jobName ?? 'n/a'} skills=${loadedSkills.join(',') || 'none'} sessionReused=${sessionsByChatId.get(chatId!) === session ? 'true' : 'false'}`,
            );
            executionLogger.write(
                `query started source=${source} chatId=${chatId} jobName=${jobName ?? 'n/a'} skills=${loadedSkills.join(',') || 'none'}`,
            );

            try {
                console.log(`[claude] first stream event afterMs=${Date.now() - startedAt} event=turn-start`);
                executionLogger.write(`first stream event afterMs=${Date.now() - startedAt} event=turn-start`);
                result = await runOnSession(session, finalPrompt, executionLogger);
            } catch (error) {
                if (sessionsByChatId.get(chatId!) === session) sessionsByChatId.delete(chatId!);
                executionLogger.write(
                    `parent run failed source=${source} chatId=${chatId} jobName=${jobName ?? 'n/a'} durationMs=${Date.now() - startedAt} error=${getErrorMessage(error)}`,
                );
                console.error(
                    `[claude] parent run failed source=${source} chatId=${chatId} jobName=${jobName ?? 'n/a'} durationMs=${Date.now() - startedAt} error=${getErrorMessage(error)}`,
                    getErrorStack(error),
                );
                throw error;
            }
        } else {
            const options = createParentOptions({ parent, mcpServers });
            loadedSkills = availableSkills(SKILL_POLICY, { mcpServers: options.mcpServers });

            console.log(
                `[claude] query started source=${source ?? 'unknown'} chatId=${chatId ?? 'n/a'} jobName=${jobName ?? 'n/a'} skills=${loadedSkills.join(',') || 'none'}`,
            );
            executionLogger.write(
                `query started source=${source ?? 'unknown'} chatId=${chatId ?? 'n/a'} jobName=${jobName ?? 'n/a'} skills=${loadedSkills.join(',') || 'none'}`,
            );

            try {
                result = await runOneShot(queryImpl, options, finalPrompt, executionLogger, (event) => {
                    console.log(
                        `[claude] first stream event afterMs=${Date.now() - startedAt} event=${summarizeStreamEvent(event)}`,
                    );
                    executionLogger.write(
                        `first stream event afterMs=${Date.now() - startedAt} event=${summarizeStreamEvent(event)}`,
                    );
                });
            } catch (error) {
                executionLogger.write(
                    `parent run failed source=${source ?? 'unknown'} chatId=${chatId ?? 'n/a'} jobName=${jobName ?? 'n/a'} durationMs=${Date.now() - startedAt} error=${getErrorMessage(error)}`,
                );
                console.error(
                    `[claude] parent run failed source=${source ?? 'unknown'} chatId=${chatId ?? 'n/a'} jobName=${jobName ?? 'n/a'} durationMs=${Date.now() - startedAt} error=${getErrorMessage(error)}`,
                    getErrorStack(error),
                );
                throw error;
            }
        }

        console.log(
            `[claude] parent run completed source=${source ?? 'unknown'} chatId=${chatId ?? 'n/a'} jobName=${jobName ?? 'n/a'} durationMs=${Date.now() - startedAt} outputLength=${result.length}`,
        );
        executionLogger.write(
            `parent run completed source=${source ?? 'unknown'} chatId=${chatId ?? 'n/a'} jobName=${jobName ?? 'n/a'} durationMs=${Date.now() - startedAt} outputLength=${result.length}`,
        );

        return { loadedSkills, output: result };
    };
}

export {
    PARENT_SKILLS,
    PARENT_BASE_TOOLS,
    SKILL_POLICY,
    buildInvocationPrompt,
    createParentAgentRunner,
    createParentOptions,
    formatExecutionLogEvent,
    summarizeStreamEvent,
};
export type {
    McpServers,
    ParentConfig,
    ParentAgentOptions,
    ParentInvocationInput,
    ParentInvocationResult,
    ParentOptionsInput,
    ParentRunner,
    ParentRunnerFactoryInput,
    QueryFn,
};
