import nodeCron from 'node-cron';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { CronLike, RunParentAgent, TelegramBotLike } from './job-scheduler.js';
import { isSkipOutput } from './skip-output.js';
import { markdownToTelegramHtml } from './telegram-format.js';

type ScheduleMode = 'llm' | 'message';

type DynamicScheduleRecord = {
    id: string;
    mode: ScheduleMode;
    schedule: string;
    cronExpr: string;
    isOneShot: boolean;
    label: string | null;
    prompt: string | null;
    message: string | null;
    chatId: string | null;
    createdAt: string;
};

type DynamicScheduleInput = {
    schedule: string;
    label?: string;
    chatId?: string;
};

type DynamicTaskInput = DynamicScheduleInput & {
    prompt: string;
};

type DynamicMessageInput = DynamicScheduleInput & {
    message: string;
};

type DynamicSchedulerDeps = {
    bot: TelegramBotLike;
    runParentAgent: RunParentAgent | null;
    defaultChatId?: string;
    persistPath: string;
    timezone: string;
    cron?: CronLike;
};

type DynamicScheduler = {
    scheduleTask: (input: DynamicTaskInput) => string;
    scheduleMessage: (input: DynamicMessageInput) => string;
    cancelSchedule: (id: string) => boolean;
    listSchedules: () => DynamicScheduleRecord[];
    reloadFromDisk: () => void;
};

type CronTaskLike = {
    stop: () => void;
};

type ScheduleParseResult = {
    cronExpr: string;
    isOneShot: boolean;
};

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function slugify(str: string): string {
    return String(str)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'schedule';
}

function generateId(label: string, existingIds: Set<string>): string {
    const base = `${slugify(label)}-${Math.floor(Date.now() / 1000)}`;
    if (!existingIds.has(base)) return base;
    let counter = 2;
    while (existingIds.has(`${base}-${counter}`)) counter++;
    return `${base}-${counter}`;
}

function parseSchedule(schedule: string, timezone: string): ScheduleParseResult {
    if (nodeCron.validate(schedule)) {
        return { cronExpr: schedule, isOneShot: false };
    }
    const dt = new Date(schedule);
    if (!isNaN(dt.getTime())) {
        if (dt <= new Date()) {
            throw new Error(`Scheduled datetime is in the past: ${schedule}`);
        }
        // Extract components in deps.timezone so the cron expression aligns with
        // the timezone node-cron uses. getHours() etc. would use server local time
        // and produce the wrong cron fields when server TZ != deps.timezone.
        const parts = Object.fromEntries(
            new Intl.DateTimeFormat('en', {
                timeZone: timezone,
                minute: 'numeric',
                hour: 'numeric',
                day: 'numeric',
                month: 'numeric',
                hourCycle: 'h23',
            })
                .formatToParts(dt)
                .map(({ type, value }) => [type, value]),
        );
        const m = parseInt(parts.minute ?? '0', 10);
        const h = parseInt(parts.hour ?? '0', 10);
        const d = parseInt(parts.day ?? '0', 10);
        const mo = parseInt(parts.month ?? '0', 10);
        return { cronExpr: `${m} ${h} ${d} ${mo} *`, isOneShot: true };
    }
    throw new Error(`Invalid schedule: must be a cron expression or ISO 8601 datetime, got: "${schedule}"`);
}

function createDynamicScheduler(deps: DynamicSchedulerDeps): DynamicScheduler {
    // deps.runParentAgent may be null at construction time — injected later
    const tasks = new Map<string, { record: DynamicScheduleRecord; cronTask: CronTaskLike }>();

    function _persist(): void {
        const records = [...tasks.values()].map((t) => t.record);
        const dir = dirname(deps.persistPath);
        mkdirSync(dir, { recursive: true });
        const tmp = `${deps.persistPath}.tmp`;
        writeFileSync(tmp, JSON.stringify(records, null, 2), 'utf8');
        renameSync(tmp, deps.persistPath);
    }

    function _activate(record: DynamicScheduleRecord): void {
        const cronTask = (deps.cron
            ? deps.cron.schedule(record.cronExpr, _makeCallback(record), { timezone: deps.timezone })
            : nodeCron.schedule(record.cronExpr, _makeCallback(record), { timezone: deps.timezone })) as CronTaskLike;
        tasks.set(record.id, { record, cronTask });
    }

    function _makeCallback(record: DynamicScheduleRecord): () => Promise<void> {
        return async () => {
            console.log(`[scheduler] firing: ${record.id} (${record.mode})`);
            const chatId = record.chatId ?? deps.defaultChatId;
            try {
                if (record.mode === 'message') {
                    if (chatId) {
                        await deps.bot.telegram
                            .sendMessage(chatId, markdownToTelegramHtml(record.message ?? ''), { parse_mode: 'HTML' })
                            .catch((err) => console.error(`[scheduler] telegram send failed: ${getErrorMessage(err)}`));
                    }
                } else {
                    if (!deps.runParentAgent) {
                        throw new Error('runParentAgent not yet available');
                    }
                    const { output } = await deps.runParentAgent({
                        chatId: chatId ?? 'global',
                        jobName: record.id,
                        prompt: record.prompt ?? '',
                        source: 'scheduler',
                    });
                    const shouldSkip = isSkipOutput(output);
                    if (chatId && !shouldSkip) {
                        await deps.bot.telegram
                            .sendMessage(chatId, markdownToTelegramHtml(output), { parse_mode: 'HTML' })
                            .catch((err) => console.error(`[scheduler] telegram send failed: ${getErrorMessage(err)}`));
                    }
                }
            } catch (err) {
                console.error(`[scheduler] failed: ${record.id} — ${getErrorMessage(err)}`);
                if (chatId) {
                    await deps.bot.telegram
                        .sendMessage(chatId, `Scheduled task "${record.label ?? record.id}" failed: ${getErrorMessage(err)}`)
                        .catch((e) => console.error(`[scheduler] telegram error send failed: ${getErrorMessage(e)}`));
                }
            } finally {
                if (record.isOneShot) {
                    const entry = tasks.get(record.id);
                    if (entry) entry.cronTask.stop();
                    tasks.delete(record.id);
                    _persist();
                }
            }
        };
    }

    function _createRecord(input: DynamicTaskInput | DynamicMessageInput, mode: ScheduleMode): DynamicScheduleRecord {
        const { cronExpr, isOneShot } = parseSchedule(input.schedule, deps.timezone);
        const existingIds = new Set(tasks.keys());
        const id = generateId(input.label ?? (mode === 'llm' ? 'task' : 'message'), existingIds);
        return {
            id,
            mode,
            schedule: input.schedule,
            cronExpr,
            isOneShot,
            label: input.label ?? null,
            prompt: mode === 'llm' ? (input as DynamicTaskInput).prompt : null,
            message: mode === 'message' ? (input as DynamicMessageInput).message : null,
            chatId: input.chatId ?? null,
            createdAt: new Date().toISOString(),
        };
    }

    function scheduleTask(input: DynamicTaskInput): string {
        const record = _createRecord(input, 'llm');
        _activate(record);
        _persist();
        console.log(`[scheduler] scheduled task: ${record.id} (${record.schedule})`);
        return record.id;
    }

    function scheduleMessage(input: DynamicMessageInput): string {
        const record = _createRecord(input, 'message');
        _activate(record);
        _persist();
        console.log(`[scheduler] scheduled message: ${record.id} (${record.schedule})`);
        return record.id;
    }

    function cancelSchedule(id: string): boolean {
        const entry = tasks.get(id);
        if (!entry) return false;
        entry.cronTask.stop();
        tasks.delete(id);
        _persist();
        console.log(`[scheduler] cancelled: ${id}`);
        return true;
    }

    function listSchedules(): DynamicScheduleRecord[] {
        return [...tasks.values()].map((t) => t.record);
    }

    function reloadFromDisk(): void {
        let records: DynamicScheduleRecord[];
        try {
            const raw = readFileSync(deps.persistPath, 'utf8');
            records = JSON.parse(raw) as DynamicScheduleRecord[];
        } catch (err) {
            if (err && typeof err === 'object' && 'code' in err && err.code === 'ENOENT') return;
            console.error(`[scheduler] failed to read persisted schedules: ${getErrorMessage(err)}`);
            return;
        }

        const now = new Date();
        const active = records.filter((r) => {
            if (r.isOneShot) {
                // Use the original ISO string — reconstructing from cron fields
                // would interpret them in server local time, not deps.timezone.
                const target = new Date(r.schedule);
                if (isNaN(target.getTime()) || target <= now) return false;
            }
            return true;
        });

        for (const record of active) {
            _activate(record);
        }

        if (active.length !== records.length) {
            _persist();
        }

        console.log(`[scheduler] reloaded ${active.length} schedule(s)`);
    }

    return { scheduleTask, scheduleMessage, cancelSchedule, listSchedules, reloadFromDisk };
}

export { createDynamicScheduler };
export type {
    DynamicMessageInput,
    DynamicScheduleInput,
    DynamicScheduleRecord,
    DynamicScheduler,
    DynamicSchedulerDeps,
    DynamicTaskInput,
    ScheduleMode,
    ScheduleParseResult,
};
