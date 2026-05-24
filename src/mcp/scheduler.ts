import { defineTool } from '@earendil-works/pi-coding-agent';
import { Type } from '@earendil-works/pi-ai';
import type { DynamicScheduler } from '../dynamic-scheduler.js';

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function createSchedulerTools(dynamicScheduler: DynamicScheduler) {
    return [
        defineTool({
            name: 'mcp__scheduler__schedule_task',
            label: 'Schedule Task',
            description: 'Schedule a future LLM invocation. At the scheduled time, the parent agent runs the given prompt and sends the result to Telegram. Accepts a cron expression (e.g. "0 9 * * 1-5") or an ISO 8601 datetime (e.g. "2026-05-15T09:00:00") for a one-shot run.',
            parameters: Type.Object({
                schedule: Type.String({ description: 'Cron expression or ISO 8601 datetime for when to run' }),
                prompt: Type.String({ description: 'Prompt to send to the parent agent when the schedule fires' }),
                label: Type.Optional(Type.String({ description: 'Human-readable name for this schedule' })),
                chat_id: Type.Optional(Type.String({ description: 'Telegram chat ID to send the result to. Defaults to DEFAULT_CHAT_ID.' })),
            }),
            execute: async (_toolCallId, args) => {
                try {
                    const id = dynamicScheduler.scheduleTask({
                        schedule: args.schedule,
                        prompt: args.prompt,
                        label: args.label,
                        chatId: args.chat_id,
                    });
                    return {
                        content: [{ type: 'text' as const, text: JSON.stringify({ id, label: args.label ?? id, schedule: args.schedule, mode: 'llm' }) }],
                        details: {},
                    };
                } catch (err) {
                    return {
                        content: [{ type: 'text' as const, text: `Error: ${getErrorMessage(err)}` }],
                        details: {},
                        isError: true,
                    };
                }
            },
        }),
        defineTool({
            name: 'mcp__scheduler__schedule_message',
            label: 'Schedule Message',
            description: 'Pre-compute a message now and schedule it to be sent to Telegram later. No LLM runs at send time - the exact message text is delivered as-is. Accepts a cron expression or ISO 8601 datetime.',
            parameters: Type.Object({
                schedule: Type.String({ description: 'Cron expression or ISO 8601 datetime for when to send' }),
                message: Type.String({ description: 'The exact message text to send at the scheduled time' }),
                label: Type.Optional(Type.String({ description: 'Human-readable name for this schedule' })),
                chat_id: Type.Optional(Type.String({ description: 'Telegram chat ID to send the message to. Defaults to DEFAULT_CHAT_ID.' })),
            }),
            execute: async (_toolCallId, args) => {
                try {
                    const id = dynamicScheduler.scheduleMessage({
                        schedule: args.schedule,
                        message: args.message,
                        label: args.label,
                        chatId: args.chat_id,
                    });
                    return {
                        content: [{ type: 'text' as const, text: JSON.stringify({ id, label: args.label ?? id, schedule: args.schedule, mode: 'message' }) }],
                        details: {},
                    };
                } catch (err) {
                    return {
                        content: [{ type: 'text' as const, text: `Error: ${getErrorMessage(err)}` }],
                        details: {},
                        isError: true,
                    };
                }
            },
        }),
        defineTool({
            name: 'mcp__scheduler__list_schedules',
            label: 'List Schedules',
            description: 'List all currently active dynamic schedules (both LLM tasks and pre-computed messages).',
            parameters: Type.Object({}),
            execute: async () => {
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
                return { content: [{ type: 'text' as const, text }], details: {} };
            },
        }),
        defineTool({
            name: 'mcp__scheduler__cancel_schedule',
            label: 'Cancel Schedule',
            description: 'Cancel an active dynamic schedule by its ID.',
            parameters: Type.Object({
                id: Type.String({ description: 'The schedule ID returned by schedule_task or schedule_message' }),
            }),
            execute: async (_toolCallId, args) => {
                const cancelled = dynamicScheduler.cancelSchedule(args.id);
                const text = cancelled
                    ? JSON.stringify({ cancelled: true, id: args.id })
                    : `Error: No schedule found with id "${args.id}"`;
                return { content: [{ type: 'text' as const, text }], details: {}, isError: !cancelled };
            },
        }),
    ];
}

export { createSchedulerTools };
