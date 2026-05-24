import { randomUUID } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateText, tool, stepCountIs } from 'ai';
import type { ModelMessage } from 'ai';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import type { BotConfig } from './bot-config-loader.js';
import { parseFrontmatter } from './bot-config-loader.js';
import { buildContextString, computeDateContext } from './date-context.js';
import { createVaultWorkingCopy } from './vault-working-copy.js';
import { loadMessages, appendMessages } from './conversation-history.js';
import type { ParentTools } from './parent-tools.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const parentSkillsDir = resolve(__dirname, '../plugins/parent-skills/skills');
const conversationsDir = resolve(__dirname, '../conversations/chats');

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
    tools?: ParentTools;
};

type ParentRunnerFactoryInput = ParentOptionsInput & {
    executionLogPath?: string;
};

type ExecutionLogger = {
    path: string;
    write: (message: string) => void;
};

const DEFAULT_MODEL_SPEC = 'google/gemini-2.5-flash';

const MODEL_ALIASES: Record<string, string> = {
    sonnet: 'anthropic/claude-sonnet-4-6',
    opus: 'anthropic/claude-opus-4-7',
    haiku: 'anthropic/claude-haiku-4-5',
    gemini: 'google/gemini-2.5-flash',
};

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function getErrorStack(error: unknown): string {
    return error instanceof Error ? (error.stack ?? '') : '';
}

function resolveModelId(spec: string): string {
    return MODEL_ALIASES[spec] ?? spec;
}

function createExecutionLogger(logPath: string, runId: string): ExecutionLogger {
    mkdirSync(dirname(logPath), { recursive: true });
    return {
        path: logPath,
        write(message: string) {
            const timestamp = new Date().toISOString();
            appendFileSync(logPath, `[${timestamp}] [${runId}] ${message}\n`, 'utf8');
        },
    };
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

function buildInvocationPrompt({ prompt = '', source = 'unknown', jobName, chatId }: ParentInvocationInput): string {
    const lines = ['[Invocation metadata]', `source: ${source}`];
    if (jobName) lines.push(`job_name: ${jobName}`);
    if (chatId) lines.push(`chat_id: ${chatId}`);
    lines.push('[/Invocation metadata]', '', prompt);
    return lines.join('\n');
}

type SkillDefinition = {
    name: string;
    description: string;
    body: string;
};

function loadSkills(): SkillDefinition[] {
    if (!existsSync(parentSkillsDir)) return [];
    const skills: SkillDefinition[] = [];
    try {
        const entries = readdirSync(parentSkillsDir, { withFileTypes: true });
        for (const entry of entries) {
            if (!entry.isDirectory()) continue;
            const skillPath = join(parentSkillsDir, entry.name, 'SKILL.md');
            if (!existsSync(skillPath)) continue;
            try {
                const content = readFileSync(skillPath, 'utf8');
                const { frontmatter, body } = parseFrontmatter(content);
                const expanded = body.replace(/\$\{([^}]+)\}/g, (_, key) => process.env[key] ?? `\${${key}}`);
                skills.push({
                    name: typeof frontmatter.name === 'string' ? frontmatter.name : entry.name,
                    description: typeof frontmatter.description === 'string' ? frontmatter.description : '',
                    body: expanded,
                });
            } catch {
                // skip malformed skill files
            }
        }
    } catch {
        // skip unreadable skills directory
    }
    return skills;
}

function buildSystemPrompt(parent: ParentConfig, skills: SkillDefinition[]): string {
    let prompt = parent.systemPrompt;
    if (skills.length > 0) {
        prompt += '\n\n---\n\n## Skills\n\n';
        prompt += skills.map((s) => s.body).join('\n\n---\n\n');
    }
    return prompt;
}

function shouldLoadHistory(source: string | undefined, chatId: string | undefined): boolean {
    return (source === 'telegram' || source === 'job') && !!chatId;
}

function shouldAppendHistory(source: string | undefined): boolean {
    return source === 'telegram' || source === 'job';
}

function createParentAgentRunner({
    parent,
    tools: domainTools = {},
    executionLogPath,
}: ParentRunnerFactoryInput): ParentRunner {
    const logPath =
        executionLogPath ??
        process.env.EXECUTION_LOG_PATH ??
        process.env.PI_EXECUTION_LOG_PATH ??
        process.env.CLAUDE_EXECUTION_LOG_PATH ??
        resolve(__dirname, '../logs/execution.log');

    const modelSpec = process.env.AI_MODEL ?? process.env.PI_MODEL ?? DEFAULT_MODEL_SPEC;
    const modelId = resolveModelId(modelSpec);
    const openrouter = createOpenRouter({ apiKey: process.env.OPENROUTER_API_KEY });
    console.log("model Id", modelId)
    const model = openrouter(modelId);

    const skills = loadSkills();
    const systemPrompt = buildSystemPrompt(parent, skills);
    const vaultPath = parent.directories[0];

    return async function runParentAgent({ prompt = '', source, jobName, chatId } = {}) {
        const startedAt = Date.now();
        const runId = randomUUID();
        const executionLogger = createExecutionLogger(logPath, runId);

        executionLogger.write(
            `parent run started source=${source ?? 'unknown'} chatId=${chatId ?? 'n/a'} jobName=${jobName ?? 'n/a'} model=${modelId}`,
        );
        console.log(
            `[agent] parent run started source=${source ?? 'unknown'} chatId=${chatId ?? 'n/a'} jobName=${jobName ?? 'n/a'} model=${modelId}`,
        );

        const finalPrompt = `${buildDateContext()}\n\n${buildInvocationPrompt({ chatId, jobName, prompt, source })}`;

        // Build conversation messages
        const history: ModelMessage[] = shouldLoadHistory(source, chatId)
            ? (loadMessages(conversationsDir, chatId!, 50) as ModelMessage[])
            : [];
        const messages: ModelMessage[] = [...history, { role: 'user', content: finalPrompt }];

        // Set up vault working copy tools if vault path is configured
        let vwcTools: Record<string, ReturnType<typeof tool>> = {};
        let vwc: ReturnType<typeof createVaultWorkingCopy> | null = null;
        if (vaultPath) {
            vwc = createVaultWorkingCopy({ vaultPath });
            vwcTools = vwc.tools as Record<string, ReturnType<typeof tool>>;
        }

        const allTools = { ...vwcTools, ...domainTools };

        console.log("system prompt", systemPrompt)
        console.log("all tools", allTools);

        let output = '';
        try {
            const result = await generateText({
                model,
                system: systemPrompt,
                messages,
                tools: allTools,
                stopWhen: stepCountIs(15),
            });

            output = result.text;

            // Log steps
            for (const step of result.steps) {
                for (const tc of step.toolCalls) {
                    executionLogger.write(`tool use: ${tc.toolName}`);
                    process.stdout.write(`[tool] ${tc.toolName}\n`);
                }
                for (const tr of step.toolResults) {
                    executionLogger.write(`tool result:success`);
                    process.stdout.write(`[result] ${tr.toolName} completed\n`);
                }
                if (step.text) process.stdout.write(step.text);
            }

            // Commit vault writes
            if (vwc) {
                const persisted = vwc.commitDiffs((msg) => executionLogger.write(msg));
                if (persisted.length > 0) {
                    executionLogger.write(`persisted files: ${persisted.join(', ')}`);
                }
            }

            // Append to conversation history
            if (shouldAppendHistory(source) && chatId) {
                const shouldSave = source === 'telegram' || (output.trim() !== '[SKIP]' && output.trim() !== '');
                if (shouldSave) {
                    appendMessages(conversationsDir, chatId, [
                        { role: 'user', content: finalPrompt },
                        { role: 'assistant', content: output },
                    ]);
                }
            }

            executionLogger.write(
                `parent run completed source=${source ?? 'unknown'} chatId=${chatId ?? 'n/a'} jobName=${jobName ?? 'n/a'} durationMs=${Date.now() - startedAt} outputLength=${output.length}`,
            );
            console.log(
                `[agent] parent run completed source=${source ?? 'unknown'} chatId=${chatId ?? 'n/a'} jobName=${jobName ?? 'n/a'} durationMs=${Date.now() - startedAt} outputLength=${output.length}`,
            );
        } catch (error) {
            executionLogger.write(
                `parent run failed source=${source ?? 'unknown'} chatId=${chatId ?? 'n/a'} jobName=${jobName ?? 'n/a'} durationMs=${Date.now() - startedAt} error=${getErrorMessage(error)}`,
            );
            console.error(
                `[agent] parent run failed source=${source ?? 'unknown'} chatId=${chatId ?? 'n/a'} jobName=${jobName ?? 'n/a'} durationMs=${Date.now() - startedAt} error=${getErrorMessage(error)}`,
                getErrorStack(error),
            );
            throw error;
        }

        return { output };
    };
}

export {
    buildInvocationPrompt,
    createParentAgentRunner,
    MODEL_ALIASES,
    DEFAULT_MODEL_SPEC,
};
export type {
    ParentConfig,
    ParentInvocationInput,
    ParentInvocationResult,
    ParentOptionsInput,
    ParentRunner,
    ParentRunnerFactoryInput,
};
