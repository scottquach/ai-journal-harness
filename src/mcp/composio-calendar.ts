import { Composio } from '@composio/core';
import { tool, zodSchema } from 'ai';
import type { Tool } from 'ai';
import { z } from 'zod';

type ComposioCalendarConfig = {
    apiKey?: string;
    userId?: string;
};

type ComposioCalendarExecutor = (slug: string, args: Record<string, unknown>) => Promise<unknown>;

type ComposioToolSpec = {
    name: string;
    slug: string;
    description: string;
};

const CALENDAR_TOOL_SPECS: ComposioToolSpec[] = [
    {
        name: 'getCalendarEvents',
        slug: 'GOOGLECALENDAR_EVENTS_LIST_ALL_CALENDARS',
        description: 'List Google Calendar events across all calendars for a time range.',
    },
    {
        name: 'listCalendarEvents',
        slug: 'GOOGLECALENDAR_EVENTS_LIST',
        description: 'List Google Calendar events on a specified calendar, such as primary.',
    },
    {
        name: 'listCalendars',
        slug: 'GOOGLECALENDAR_LIST_CALENDARS',
        description: 'List Google Calendars available to the connected user.',
    },
    {
        name: 'createCalendarEvent',
        slug: 'GOOGLECALENDAR_CREATE_EVENT',
        description: 'Create a Google Calendar event.',
    },
    {
        name: 'updateCalendarEvent',
        slug: 'GOOGLECALENDAR_UPDATE_EVENT',
        description: 'Update an existing Google Calendar event.',
    },
    {
        name: 'deleteCalendarEvent',
        slug: 'GOOGLECALENDAR_DELETE_EVENT',
        description: 'Delete an existing Google Calendar event.',
    },
    {
        name: 'findCalendarEvent',
        slug: 'GOOGLECALENDAR_FIND_EVENT',
        description: 'Find Google Calendar events by query, calendar, and optional time range.',
    },
    {
        name: 'findCalendarFreeSlots',
        slug: 'GOOGLECALENDAR_FIND_FREE_SLOTS',
        description: 'Find free and busy slots in Google Calendar for a time range.',
    },
];

function createSdkExecutor(apiKey: string, userId: string): ComposioCalendarExecutor {
    const composio = new Composio({ apiKey });
    return (slug, args) => composio.tools.execute(slug, { userId, arguments: args });
}

function createComposioCalendarTools(
    config: ComposioCalendarConfig,
    executor?: ComposioCalendarExecutor,
): Record<string, Tool<any, any>> {
    if (!config.apiKey) return {};

    const userId = config.userId ?? 'default';
    const executeComposio = executor ?? createSdkExecutor(config.apiKey, userId);

    const argsSchema = zodSchema(
        z.object({ arguments: z.record(z.string(), z.unknown()).optional() })
    );

    return Object.fromEntries(
        CALENDAR_TOOL_SPECS.map((spec) => [
            spec.name,
            tool({
                description: `${spec.description} Executes Composio tool ${spec.slug} for configured user "${userId}".`,
                inputSchema: argsSchema,
                execute: async ({ arguments: args }) => {
                    try {
                        return await executeComposio(spec.slug, (args ?? {}) as Record<string, unknown>);
                    } catch (err) {
                        return { error: err instanceof Error ? err.message : String(err) };
                    }
                },
            }),
        ]),
    );
}

export { CALENDAR_TOOL_SPECS, createComposioCalendarTools };
export type { ComposioCalendarConfig, ComposioCalendarExecutor };
