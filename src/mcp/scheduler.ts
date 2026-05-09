import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import type { DynamicScheduler } from '../dynamic-scheduler.js';

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function createSchedulerServer(dynamicScheduler: DynamicScheduler) {
    return createSdkMcpServer({
        name: 'scheduler',
        version: '1.0.0',
        tools: [
            tool(
                'schedule_task',
                'Schedule a future LLM invocation. At the scheduled time, the parent agent runs the given prompt and sends the result to Telegram. Accepts a cron expression (e.g. "0 9 * * 1-5") or an ISO 8601 datetime (e.g. "2026-05-15T09:00:00") for a one-shot run.',
                {
                    schedule: z
                        .string()
                        .describe('Cron expression or ISO 8601 datetime for when to run'),
                    prompt: z
                        .string()
                        .describe('Prompt to send to the parent agent when the schedule fires'),
                    label: z
                        .string()
                        .optional()
                        .describe('Human-readable name for this schedule'),
                    chat_id: z
                        .string()
                        .optional()
                        .describe('Telegram chat ID to send the result to. Defaults to DEFAULT_CHAT_ID.'),
                },
                async (args) => {
                    try {
                        const id = dynamicScheduler.scheduleTask({
                            schedule: args.schedule,
                            prompt: args.prompt,
                            label: args.label,
                            chatId: args.chat_id,
                        });
                        return {
                            content: [{ type: 'text', text: JSON.stringify({ id, label: args.label ?? id, schedule: args.schedule, mode: 'llm' }) }],
                        };
                    } catch (err) {
                        return { content: [{ type: 'text', text: `Error: ${getErrorMessage(err)}` }], isError: true };
                    }
                },
            ),
            tool(
                'schedule_message',
                'Pre-compute a message now and schedule it to be sent to Telegram later. No LLM runs at send time — the exact message text is delivered as-is. Accepts a cron expression or ISO 8601 datetime.',
                {
                    schedule: z
                        .string()
                        .describe('Cron expression or ISO 8601 datetime for when to send'),
                    message: z
                        .string()
                        .describe('The exact message text to send at the scheduled time'),
                    label: z
                        .string()
                        .optional()
                        .describe('Human-readable name for this schedule'),
                    chat_id: z
                        .string()
                        .optional()
                        .describe('Telegram chat ID to send the message to. Defaults to DEFAULT_CHAT_ID.'),
                },
                async (args) => {
                    try {
                        const id = dynamicScheduler.scheduleMessage({
                            schedule: args.schedule,
                            message: args.message,
                            label: args.label,
                            chatId: args.chat_id,
                        });
                        return {
                            content: [{ type: 'text', text: JSON.stringify({ id, label: args.label ?? id, schedule: args.schedule, mode: 'message' }) }],
                        };
                    } catch (err) {
                        return { content: [{ type: 'text', text: `Error: ${getErrorMessage(err)}` }], isError: true };
                    }
                },
            ),
            tool(
                'list_schedules',
                'List all currently active dynamic schedules (both LLM tasks and pre-computed messages).',
                {},
                async () => {
                    const records = dynamicScheduler.listSchedules();
                    const summary = records.map((r) => ({
                        id: r.id,
                        label: r.label,
                        mode: r.mode,
                        schedule: r.schedule,
                        isOneShot: r.isOneShot,
                        createdAt: r.createdAt,
                        preview: r.mode === 'message'
                            ? (r.message ?? '').slice(0, 80)
                            : (r.prompt ?? '').slice(0, 80),
                    }));
                    const text = records.length === 0
                        ? 'No active dynamic schedules.'
                        : JSON.stringify(summary, null, 2);
                    return { content: [{ type: 'text', text }] };
                },
            ),
            tool(
                'cancel_schedule',
                'Cancel an active dynamic schedule by its ID.',
                {
                    id: z.string().describe('The schedule ID returned by schedule_task or schedule_message'),
                },
                async (args) => {
                    const cancelled = dynamicScheduler.cancelSchedule(args.id);
                    const text = cancelled
                        ? JSON.stringify({ cancelled: true, id: args.id })
                        : `Error: No schedule found with id "${args.id}"`;
                    return { content: [{ type: 'text', text }], isError: !cancelled };
                },
            ),
        ],
    });
}

export { createSchedulerServer };
