import nodeCron from 'node-cron';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseFrontmatter } from './bot-config-loader.js';
import type { ConversationStateStore } from './conversation-state.js';
import { isSkipOutput } from './skip-output.js';
import { markdownToTelegramHtml } from './telegram-format.js';

type JobConfig = {
    name: string;
    cron: string;
    telegram: boolean;
    prompt: string;
};

type RunParentAgentInput = {
    chatId?: string;
    jobName?: string;
    prompt?: string;
    source?: string;
};

type RunParentAgentResult = {
    output: string;
};

type RunParentAgent = (input: RunParentAgentInput) => Promise<RunParentAgentResult>;

type ConversationStoreLike = {
    appendTurn: ConversationStateStore['appendTurn'] | ((input: Parameters<ConversationStateStore['appendTurn']>[0]) => unknown);
    buildPrompt: ConversationStateStore['buildPrompt'];
};

type CronLike = {
    schedule: (expression: string, callback: () => Promise<void>, options?: { timezone?: string }) => unknown;
};

type TelegramBotLike = {
    telegram: {
        sendMessage: (chatId: string, text: string, options?: { parse_mode: 'HTML' }) => Promise<unknown>;
    };
};

type JobLoaderOptions = {
    readdir?: (directory: string) => string[];
    readFile?: (path: string) => string;
};

type ScheduleJobsOptions = JobLoaderOptions & {
    cron?: CronLike;
    defaultChatId?: string;
    runParentAgent?: RunParentAgent;
    conversationStore?: ConversationStoreLike | null;
};

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function parseJobConfig(fileContent: string): JobConfig {
    const { frontmatter, body } = parseFrontmatter(fileContent);

    if (!frontmatter.name) throw new Error('Job config missing required field: name');
    if (!frontmatter.cron) throw new Error('Job config missing required field: cron');
    if (!nodeCron.validate(String(frontmatter.cron))) {
        throw new Error(`Job config has invalid cron expression: "${frontmatter.cron}"`);
    }

    return {
        name: String(frontmatter.name),
        cron: String(frontmatter.cron),
        telegram: frontmatter.telegram === true,
        prompt: body,
    };
}

function loadJobConfigs(jobsDir: string, opts: JobLoaderOptions = {}): JobConfig[] {
    const readdir = opts.readdir ?? ((d) => readdirSync(d));
    const readFile = opts.readFile ?? ((p) => readFileSync(p, 'utf8'));

    const filenames = readdir(jobsDir);
    const mdFiles = filenames.filter((f) => f.endsWith('.md'));

    return mdFiles.map((filename) => {
        const content = readFile(join(jobsDir, filename));
        return parseJobConfig(content);
    });
}

function scheduleJobs(bot: TelegramBotLike, jobsDir: string, opts: ScheduleJobsOptions = {}): void {
    const cron = opts.cron ?? nodeCron;
    const defaultChatId = opts.defaultChatId ?? process.env.DEFAULT_CHAT_ID;
    const runParentAgent = opts.runParentAgent;
    const conversationStore = opts.conversationStore ?? null;

    if (!runParentAgent) {
        throw new Error('scheduleJobs requires a runParentAgent option');
    }

    const jobs = loadJobConfigs(jobsDir, {
        readdir: opts.readdir,
        readFile: opts.readFile,
    });

    for (const job of jobs) {
        const chatId = String(defaultChatId ?? 'global');
        cron.schedule(
            job.cron,
            async () => {
                console.log(`[job] running: ${job.name}`);
                try {
                    const promptWithContext = conversationStore?.buildPrompt({ chatId, currentInput: job.prompt }) ?? job.prompt;
                    const { output } = await runParentAgent({
                        chatId,
                        jobName: job.name,
                        prompt: promptWithContext,
                        source: 'job',
                    });
                    const shouldSkip = isSkipOutput(output);
                    console.log(`[job] completed: ${job.name} ${job.telegram}${shouldSkip ? ' (skipped)' : ''}`);
                    if (conversationStore && !shouldSkip) {
                        conversationStore.appendTurn({
                            assistantMessage: output,
                            chatId,
                            source: `job:${job.name}`,
                            userMessage: job.prompt,
                        });
                    }
                    if (job.telegram && defaultChatId && !shouldSkip) {
                        await bot.telegram
                            .sendMessage(defaultChatId, markdownToTelegramHtml(output), { parse_mode: 'HTML' })
                            .catch((err) => console.error(`[job] telegram send failed: ${getErrorMessage(err)}`));
                    }
                } catch (error) {
                    console.error(`[job] failed: ${job.name} — ${getErrorMessage(error)}`);
                    if (job.telegram && defaultChatId) {
                        await bot.telegram
                            .sendMessage(defaultChatId, `Job "${job.name}" failed: ${getErrorMessage(error)}`)
                            .catch((err) => console.error(`[job] telegram send failed: ${getErrorMessage(err)}`));
                    }
                }
            },
            { timezone: process.env.BOT_TIMEZONE ?? 'America/Chicago' },
        );

        console.log(`[job] scheduled: ${job.name} (${job.cron})`);
    }
}

export { parseJobConfig, loadJobConfigs, scheduleJobs };
export type { ConversationStoreLike, CronLike, JobConfig, JobLoaderOptions, RunParentAgent, RunParentAgentInput, RunParentAgentResult, ScheduleJobsOptions, TelegramBotLike };
