import { randomUUID } from 'node:crypto';
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    AuthStorage,
    DefaultResourceLoader,
    ModelRegistry,
    SessionManager,
    SettingsManager,
    createAgentSession,
    getAgentDir,
    loadSkillsFromDir,
} from '@earendil-works/pi-coding-agent';
import type { AgentSession, AgentSessionEvent, ToolDefinition } from '@earendil-works/pi-coding-agent';
import type { Model } from '@earendil-works/pi-ai';
import type { BotConfig } from './bot-config-loader.js';
import { buildContextString, computeDateContext } from './date-context.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const parentSkillsPluginPath = resolve(__dirname, '../plugins/parent-skills');

type ParentInvocationInput = {
    prompt?: string;
    source?: string;
    jobName?: string;
    chatId?: string;
};

type ParentInvocationResult = {
    output: string;
};

type ParentRunner = (input?: ParentInvocationInput) => Promise<ParentInvocationResult>;

type ParentConfig = BotConfig & {
    id: string;
};

type ParentOptionsInput = {
    parent: ParentConfig;
    tools?: ToolDefinition[];
};

type ExecutionLogger = {
    path: string;
    write: (message: string) => void;
    writeEvent: (event: AgentSessionEvent) => void;
};

type ParentSessionLike = Pick<AgentSession, 'prompt' | 'subscribe' | 'getLastAssistantText' | 'dispose'>;
type ParentSessionFactory = (parent: ParentConfig, tools: ToolDefinition[]) => Promise<ParentSessionLike>;

type ParentRunnerFactoryInput = ParentOptionsInput & {
    sessionFactory?: ParentSessionFactory;
    executionLogPath?: string;
};

const PARENT_BASE_TOOLS = Object.freeze(['read', 'write', 'edit', 'grep', 'find', 'ls']);
const DEFAULT_MODEL_SPEC = 'openrouter/google/gemini-2.5-flash';

const MODEL_ALIASES: Record<string, { provider: string; modelId: string }> = {
    sonnet: { provider: 'openrouter', modelId: 'anthropic/claude-sonnet-4.6' },
    opus: { provider: 'openrouter', modelId: 'anthropic/claude-opus-4.6' },
    haiku: { provider: 'openrouter', modelId: 'anthropic/claude-haiku-4.5' },
    gemini: { provider: 'openrouter', modelId: 'google/gemini-2.5-flash' },
};

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function getErrorStack(error: unknown): string {
    return error instanceof Error ? (error.stack ?? '') : '';
}

function normalizeLogText(value: string): string {
    return value.endsWith('\n') ? value.slice(0, -1) : value;
}

function getTurnErrorMessage(event: AgentSessionEvent): string | undefined {
    if (event.type !== 'turn_end') return undefined;
    const msg = (event as unknown as { message?: { stopReason?: string; errorMessage?: string } }).message;
    return msg?.stopReason === 'error' ? msg.errorMessage : undefined;
}

function formatExecutionLogEvent(event: AgentSessionEvent): string[] {
    if (event.type === 'message_update') {
        const update = event.assistantMessageEvent;
        if (update.type === 'text_delta') return [`assistant text delta:\n${normalizeLogText(update.delta)}`];
        if (update.type === 'thinking_delta') return [`assistant thinking delta:\n${normalizeLogText(update.delta)}`];
        return [`message_update:${update.type}`];
    }

    if (event.type === 'tool_execution_start') {
        return [`tool use: ${event.toolName}`];
    }

    if (event.type === 'tool_execution_end') {
        const status = event.isError ? 'error' : 'success';
        return [`tool result:${status}`];
    }

    if (event.type === 'turn_end') {
        const errMsg = getTurnErrorMessage(event);
        if (errMsg) return [`turn_end:error error=${errMsg}`];
        return ['turn_end:ok'];
    }

    if (event.type === 'agent_end') {
        return [`result:${event.willRetry ? 'retrying' : 'success'}`];
    }

    return [event.type];
}

function createExecutionLogger(logPath: string, runId: string): ExecutionLogger {
    mkdirSync(dirname(logPath), { recursive: true });

    return {
        path: logPath,
        write(message: string) {
            const timestamp = new Date().toISOString();
            appendFileSync(logPath, `[${timestamp}] [${runId}] ${message}\n`, 'utf8');
        },
        writeEvent(event: AgentSessionEvent) {
            for (const line of formatExecutionLogEvent(event)) {
                this.write(line);
            }
        },
    };
}

function logSessionEvent(event: AgentSessionEvent, executionLogger?: ExecutionLogger): void {
    executionLogger?.writeEvent(event);

    if (event.type === 'message_update') {
        const update = event.assistantMessageEvent;
        if (update.type === 'text_delta') process.stdout.write(update.delta);
        if (update.type === 'thinking_delta') process.stdout.write(`[thinking] ${update.delta}`);
    } else if (event.type === 'tool_execution_start') {
        process.stdout.write(`[tool] ${event.toolName}\n`);
    } else if (event.type === 'tool_execution_end') {
        process.stdout.write(`[result] ${event.toolName} ${event.isError ? 'failed' : 'completed'}\n`);
    } else if (event.type === 'turn_end') {
        const errMsg = getTurnErrorMessage(event);
        if (errMsg) process.stderr.write(`[pi] session error: ${errMsg}\n`);
    }
}

function buildInvocationPrompt({ prompt = '', source = 'unknown', jobName, chatId }: ParentInvocationInput): string {
    const lines = ['[Invocation metadata]', `source: ${source}`];

    if (jobName) lines.push(`job_name: ${jobName}`);
    if (chatId) lines.push(`chat_id: ${chatId}`);

    lines.push('[/Invocation metadata]', '', prompt);
    return lines.join('\n');
}

function buildDateContext(): string {
    const { today, weekNum, year } = computeDateContext();
    const weekNumPadded = String(weekNum).padStart(2, '0');
    return buildContextString({
        day_header: `## [[${today}]]`,
        weekly_note: `Journal/${year}-W${weekNumPadded}.md`,
        monthly_note: `Journal/${today.slice(0, 7)}.md`,
    });
}

function parseModelSpec(spec: string): { provider: string; modelId: string } {
    const alias = MODEL_ALIASES[spec];
    if (alias) return alias;

    const separator = spec.indexOf('/');
    if (separator === -1) {
        throw new Error(`Invalid model "${spec}". Use PI_MODEL=provider/model-id or one of: ${Object.keys(MODEL_ALIASES).join(', ')}`);
    }

    return {
        provider: spec.slice(0, separator),
        modelId: spec.slice(separator + 1),
    };
}

function resolveModel(modelRegistry: ModelRegistry, spec: string): Model<any> {
    const { provider, modelId } = parseModelSpec(spec);
    const model = modelRegistry.find(provider, modelId);
    if (!model) throw new Error(`Pi model not found: ${provider}/${modelId}`);
    return model;
}

function shouldPersistSession(source: string | undefined, chatId: string | undefined): boolean {
    return source === 'telegram' && !!chatId;
}

async function createPiParentSession(parent: ParentConfig, tools: ToolDefinition[] = []): Promise<ParentSessionLike> {
    const agentDir = getAgentDir();
    const cwd = parent.directories[0];
    const authStorage = AuthStorage.create();
    const modelRegistry = ModelRegistry.create(authStorage);
    const settingsManager = SettingsManager.create(cwd, agentDir);
    const model = resolveModel(modelRegistry, process.env.PI_MODEL ?? DEFAULT_MODEL_SPEC);

    const skillResult = loadSkillsFromDir({
        dir: resolve(parentSkillsPluginPath, 'skills'),
        source: 'parent-skills',
    });

    const loader = new DefaultResourceLoader({
        cwd,
        agentDir,
        settingsManager,
        noSkills: true,
        noExtensions: true,
        systemPromptOverride: () => parent.systemPrompt,
        skillsOverride: () => skillResult,
    });
    await loader.reload();

    const customToolNames = tools.map((t) => t.name);


    console.log("TOOLS", tools);

    const { session } = await createAgentSession({
        cwd,
        agentDir,
        model,
        thinkingLevel: 'medium',
        authStorage,
        modelRegistry,
        settingsManager,
        resourceLoader: loader,
        sessionManager: SessionManager.inMemory(cwd),
        tools: [...PARENT_BASE_TOOLS, ...customToolNames],
        customTools: tools,
    });

    return session;
}

function createParentAgentRunner({
    parent,
    tools = [],
    sessionFactory = createPiParentSession,
    executionLogPath,
}: ParentRunnerFactoryInput): ParentRunner {
    const logPath =
        executionLogPath ?? process.env.PI_EXECUTION_LOG_PATH ?? process.env.CLAUDE_EXECUTION_LOG_PATH ?? resolve(__dirname, '../logs/execution.log');
    const sessionsByChatId = new Map<string, ParentSessionLike>();
    const modelSpec = process.env.PI_MODEL ?? DEFAULT_MODEL_SPEC;

    return async function runParentAgent({ prompt = '', source, jobName, chatId } = {}) {
        const startedAt = Date.now();
        const runId = randomUUID();
        const executionLogger = createExecutionLogger(logPath, runId);
        executionLogger.write(
            `parent run started source=${source ?? 'unknown'} chatId=${chatId ?? 'n/a'} jobName=${jobName ?? 'n/a'}`,
        );
        console.log(
            `[pi] parent run started source=${source ?? 'unknown'} chatId=${chatId ?? 'n/a'} jobName=${jobName ?? 'n/a'}`,
        );

        const finalPrompt = `${buildDateContext()}\n\n${buildInvocationPrompt({ chatId, jobName, prompt, source })}`;
        const persist = shouldPersistSession(source, chatId);

        let session = persist ? sessionsByChatId.get(chatId!) : undefined;

        if (!session) {
            session = await sessionFactory(parent, tools);
            if (persist) sessionsByChatId.set(chatId!, session);
        }

        let lastTurnError: string | undefined;
        const unsubscribe = session.subscribe((event) => {
            logSessionEvent(event, executionLogger);
            const errMsg = getTurnErrorMessage(event);
            if (errMsg) lastTurnError = errMsg;
        });
        console.log(
            `[pi] query started source=${source ?? 'unknown'} chatId=${chatId ?? 'n/a'} jobName=${jobName ?? 'n/a'} model=${modelSpec}`,
        );
        executionLogger.write(
            `query started source=${source ?? 'unknown'} chatId=${chatId ?? 'n/a'} jobName=${jobName ?? 'n/a'} model=${modelSpec}`,
        );

        console.log("PROMPT", finalPrompt)

        try {
            await session.prompt(finalPrompt);
        } catch (error) {
            if (persist) sessionsByChatId.delete(chatId!);
            executionLogger.write(
                `parent run failed source=${source ?? 'unknown'} chatId=${chatId ?? 'n/a'} jobName=${jobName ?? 'n/a'} durationMs=${Date.now() - startedAt} error=${getErrorMessage(error)}`,
            );
            console.error(
                `[pi] parent run failed source=${source ?? 'unknown'} chatId=${chatId ?? 'n/a'} jobName=${jobName ?? 'n/a'} durationMs=${Date.now() - startedAt} error=${getErrorMessage(error)}`,
                getErrorStack(error),
            );
            throw error;
        } finally {
            unsubscribe();
            if (!persist) session.dispose();
        }

        const result = session.getLastAssistantText() ?? '';
        if (!result && lastTurnError) {
            throw new Error(lastTurnError);
        }
        console.log(
            `[pi] parent run completed source=${source ?? 'unknown'} chatId=${chatId ?? 'n/a'} jobName=${jobName ?? 'n/a'} durationMs=${Date.now() - startedAt} outputLength=${result.length}`,
        );
        executionLogger.write(
            `parent run completed source=${source ?? 'unknown'} chatId=${chatId ?? 'n/a'} jobName=${jobName ?? 'n/a'} durationMs=${Date.now() - startedAt} outputLength=${result.length}`,
        );

        return { output: result };
    };
}

export {
    PARENT_BASE_TOOLS,
    buildInvocationPrompt,
    createParentAgentRunner,
    formatExecutionLogEvent,
};
export type {
    ParentConfig,
    ParentInvocationInput,
    ParentInvocationResult,
    ParentOptionsInput,
    ParentRunner,
    ParentRunnerFactoryInput,
    ParentSessionFactory,
};
