import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { appendFileSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { query } from '@anthropic-ai/claude-agent-sdk';
import type { AgentRegistry } from './agent-registry.js';
import { availableSkills, parseToolsFromFrontmatter, toolsForSkills } from './tool-policy.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pluginPath = resolve(__dirname, '../plugins/caveman');
const parentSkillsPluginPath = resolve(__dirname, '../plugins/parent-skills');

/**
 * Read every subdirectory of plugins/parent-skills/skills/ and extract its
 * tool grants from SKILL.md frontmatter.  Returns a map of skill name →
 * allowed tools, sorted alphabetically so the order is deterministic.
 */
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

type ParentOptionsInput = {
    registry: AgentRegistry;
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

type QueryFn = (input: { prompt: string; options: ParentAgentOptions }) => AsyncIterable<any>;

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
            const mcpTools = (event.tools ?? []).filter((t) => t.startsWith('mcp__'));
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

function createParentOptions({ registry, mcpServers }: ParentOptionsInput): ParentAgentOptions {
    const resolvedMcpServers = resolveMcpServers(mcpServers);
    const parent = registry.parent;
    const activeSkills = availableSkills(SKILL_POLICY, { mcpServers: resolvedMcpServers });
    const allowedTools = toolsForSkills(activeSkills, SKILL_POLICY);
    const builtInTools = allowedTools.filter((toolName) => !toolName.startsWith('mcp__'));

    return {
        pathToClaudeCodeExecutable: process.env.CLAUDE_PATH ?? 'claude',
        env: process.env,
        cwd: registry.directories[0],
        additionalDirectories: registry.directories.slice(1),
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

function createParentAgentRunner({ registry, mcpServers, queryFn, executionLogPath }: ParentRunnerFactoryInput): ParentRunner {
    const claudePath = process.env.CLAUDE_PATH ?? 'claude';
    const queryImpl: QueryFn = queryFn ?? (query as unknown as QueryFn);
    const logPath = executionLogPath ?? process.env.CLAUDE_EXECUTION_LOG_PATH ?? resolve(__dirname, '../logs/execution.log');

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

        const options = createParentOptions({ registry, mcpServers });
        const loadedSkills = availableSkills(SKILL_POLICY, { mcpServers: options.mcpServers });
        const finalPrompt = buildInvocationPrompt({ chatId, jobName, prompt, source });
        let result: string | null = null;
        let firstEventLogged = false;

        console.log(
            `[claude] query started source=${source ?? 'unknown'} chatId=${chatId ?? 'n/a'} jobName=${jobName ?? 'n/a'} skills=${loadedSkills.join(',') || 'none'}`,
        );
        executionLogger.write(
            `query started source=${source ?? 'unknown'} chatId=${chatId ?? 'n/a'} jobName=${jobName ?? 'n/a'} skills=${loadedSkills.join(',') || 'none'}`,
        );

        try {
            for await (const message of queryImpl({ prompt: finalPrompt, options })) {
                if (!firstEventLogged) {
                    firstEventLogged = true;
                    console.log(
                        `[claude] first stream event afterMs=${Date.now() - startedAt} event=${summarizeStreamEvent(message)}`,
                    );
                    executionLogger.write(
                        `first stream event afterMs=${Date.now() - startedAt} event=${summarizeStreamEvent(message)}`,
                    );
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
        } catch (error) {
            executionLogger.write(
                `parent run failed source=${source ?? 'unknown'} chatId=${chatId ?? 'n/a'} jobName=${jobName ?? 'n/a'} durationMs=${Date.now() - startedAt} firstEventSeen=${firstEventLogged} error=${getErrorMessage(error)}`,
            );
            console.error(
                `[claude] parent run failed source=${source ?? 'unknown'} chatId=${chatId ?? 'n/a'} jobName=${jobName ?? 'n/a'} durationMs=${Date.now() - startedAt} firstEventSeen=${firstEventLogged} error=${getErrorMessage(error)}`,
                getErrorStack(error),
            );
            throw error;
        }

        console.log(
            `[claude] parent run completed source=${source ?? 'unknown'} chatId=${chatId ?? 'n/a'} jobName=${jobName ?? 'n/a'} durationMs=${Date.now() - startedAt} outputLength=${(result ?? '').length}`,
        );
        executionLogger.write(
            `parent run completed source=${source ?? 'unknown'} chatId=${chatId ?? 'n/a'} jobName=${jobName ?? 'n/a'} durationMs=${Date.now() - startedAt} outputLength=${(result ?? '').length}`,
        );

        return {
            loadedSkills,
            output: result ?? '',
        };
    };
}

export {
    PARENT_SKILLS,
    SKILL_POLICY,
    buildInvocationPrompt,
    createParentAgentRunner,
    createParentOptions,
    formatExecutionLogEvent,
    summarizeStreamEvent,
};
export type {
    McpServers,
    ParentAgentOptions,
    ParentInvocationInput,
    ParentInvocationResult,
    ParentOptionsInput,
    ParentRunner,
    ParentRunnerFactoryInput,
    QueryFn,
};
