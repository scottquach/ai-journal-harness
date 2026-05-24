import { tool, zodSchema } from 'ai';
import { z } from 'zod';
import type { DynamicScheduler } from '../dynamic-scheduler.js';

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function createSchedulerTools(dynamicScheduler: DynamicScheduler) {
    return {
        scheduleTask: tool({
            description:
                'Schedule a future LLM invocation. At the scheduled time, the parent agent runs the given prompt and sends the result to Telegram. Accepts a cron expression (e.g. "0 9 * * 1-5") or an ISO 8601 datetime (e.g. "2026-05-15T09:00:00") for a one-shot run.',
            inputSchema: zodSchema(z.object({
                schedule: z.string().describe('Cron expression or ISO 8601 datetime for when to run'),
                prompt: z.string().describe('Prompt to send to the parent agent when the schedule fires'),
                label: z.string().optional().describe('Human-readable name for this schedule'),
                chat_id: z.string().optional().describe('Telegram chat ID to send the result to. Defaults to DEFAULT_CHAT_ID.'),
            })),
            execute: async ({ schedule, prompt, label, chat_id }) => {
                try {
                    const id = dynamicScheduler.scheduleTask({ schedule, prompt, label, chatId: chat_id });
                    return { id, label: label ?? id, schedule, mode: 'llm' };
                } catch (err) {
                    return { error: getErrorMessage(err) };
                }
            },
        }),

        scheduleMessage: tool({
            description:
                'Pre-compute a message now and schedule it to be sent to Telegram later. No LLM runs at send time — the exact message text is delivered as-is. Accepts a cron expression or ISO 8601 datetime.',
            inputSchema: zodSchema(z.object({
                schedule: z.string().describe('Cron expression or ISO 8601 datetime for when to send'),
                message: z.string().describe('The exact message text to send at the scheduled time'),
                label: z.string().optional().describe('Human-readable name for this schedule'),
                chat_id: z.string().optional().describe('Telegram chat ID to send the message to. Defaults to DEFAULT_CHAT_ID.'),
            })),
            execute: async ({ schedule, message, label, chat_id }) => {
                try {
                    const id = dynamicScheduler.scheduleMessage({ schedule, message, label, chatId: chat_id });
                    return { id, label: label ?? id, schedule, mode: 'message' };
                } catch (err) {
                    return { error: getErrorMessage(err) };
                }
            },
        }),

        listSchedules: tool({
            description: 'List all currently active dynamic schedules (both LLM tasks and pre-computed messages).',
            inputSchema: zodSchema(z.object({})),
            execute: async () => {
                const records = dynamicScheduler.listSchedules();
                if (records.length === 0) return 'No active dynamic schedules.';
                return records.map((r) => ({
                    id: r.id,
                    label: r.label,
                    mode: r.mode,
                    schedule: r.schedule,
                    isOneShot: r.isOneShot,
                    createdAt: r.createdAt,
                    preview: r.mode === 'message' ? (r.message ?? '').slice(0, 80) : (r.prompt ?? '').slice(0, 80),
                }));
            },
        }),

        cancelSchedule: tool({
            description: 'Cancel an active dynamic schedule by its ID.',
            inputSchema: zodSchema(z.object({
                id: z.string().describe('The schedule ID returned by scheduleTask or scheduleMessage'),
            })),
            execute: async ({ id }) => {
                const cancelled = dynamicScheduler.cancelSchedule(id);
                if (cancelled) return { cancelled: true, id };
                return { error: `No schedule found with id "${id}"` };
            },
        }),
    };
}

export { createSchedulerTools };
