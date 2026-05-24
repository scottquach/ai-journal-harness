import nodeCron from 'node-cron';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseFrontmatter } from './bot-config-loader.js';
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

type CronLike = {
    schedule: (expression: string, callback: () => Promise<void>, options?: { timezone?: string }) => unknown;
};

type TelegramSend = (chatId: string, text: string, options?: { parse_mode: 'HTML' }) => Promise<unknown>;

type JobLoaderOptions = {
    readdir?: (directory: string) => string[];
    readFile?: (path: string) => string;
};

type ScheduleJobsOptions = JobLoaderOptions & {
    cron?: CronLike;
    defaultChatId?: string;
    runParentAgent?: RunParentAgent;
    telegramSend?: TelegramSend;
};

type TelegramBotLike = {
    telegram: {
        sendMessage: TelegramSend;
    };
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

function scheduleJobs(jobsDir: string, opts: ScheduleJobsOptions): void {
    const cron = opts.cron ?? nodeCron;
    const defaultChatId = opts.defaultChatId ?? process.env.DEFAULT_CHAT_ID;
    const runParentAgent = opts.runParentAgent;

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
                    const { output } = await runParentAgent({
                        chatId,
                        jobName: job.name,
                        prompt: job.prompt,
                        source: 'job',
                    });
                    const shouldSkip = isSkipOutput(output);
                    console.log(`[job] completed: ${job.name} telegram=${job.telegram}${shouldSkip ? ' (skipped)' : ''}`);
                    if (job.telegram && defaultChatId && !shouldSkip && opts.telegramSend) {
                        await opts.telegramSend(defaultChatId, markdownToTelegramHtml(output), { parse_mode: 'HTML' })
                            .catch((err) => console.error(`[job] telegram send failed: ${getErrorMessage(err)}`));
                    }
                } catch (error) {
                    console.error(`[job] failed: ${job.name} — ${getErrorMessage(error)}`);
                    if (job.telegram && defaultChatId && opts.telegramSend) {
                        await opts.telegramSend(defaultChatId, `Job "${job.name}" failed: ${getErrorMessage(error)}`)
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
export type { CronLike, JobConfig, JobLoaderOptions, RunParentAgent, RunParentAgentInput, RunParentAgentResult, ScheduleJobsOptions, TelegramBotLike, TelegramSend };
