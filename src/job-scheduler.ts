import nodeCron from 'node-cron';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseFrontmatter } from './bot-config-loader.js';
import type { DispatchTurn } from './dispatch-turn.js';

type JobConfig = {
    name: string;
    cron: string;
    telegram: boolean;
    prompt: string;
};

type CronLike = {
    schedule: (expression: string, callback: () => Promise<void>, options?: { timezone?: string }) => unknown;
};

type JobLoaderOptions = {
    readdir?: (directory: string) => string[];
    readFile?: (path: string) => string;
};

type ScheduleJobsOptions = JobLoaderOptions & {
    cron?: CronLike;
    defaultChatId?: string;
    dispatchTurn: DispatchTurn;
};

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
    const dispatchTurn = opts.dispatchTurn;

    if (!dispatchTurn) {
        throw new Error('scheduleJobs requires a dispatchTurn option');
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
                const result = await dispatchTurn({
                    source: 'job',
                    chatId,
                    input: job.prompt,
                    deliverTo: job.telegram ? (defaultChatId ?? null) : null,
                    errorLabel: `Job "${job.name}"`,
                    jobName: job.name,
                });
                console.log(
                    `[job] completed: ${job.name} telegram=${job.telegram}${result.skipped ? ' (skipped)' : ''}${result.error ? ' (errored)' : ''}`,
                );
            },
            { timezone: process.env.BOT_TIMEZONE ?? 'America/Chicago' },
        );

        console.log(`[job] scheduled: ${job.name} (${job.cron})`);
    }
}

export { parseJobConfig, loadJobConfigs, scheduleJobs };
export type { CronLike, JobConfig, JobLoaderOptions, ScheduleJobsOptions };
