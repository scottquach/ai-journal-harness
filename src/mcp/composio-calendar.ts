import { Composio } from '@composio/core';
import { defineTool } from '@earendil-works/pi-coding-agent';
import { Type } from '@earendil-works/pi-ai';

type ComposioCalendarConfig = {
    apiKey?: string;
    userId?: string;
};

type ComposioCalendarExecutor = (slug: string, args: Record<string, unknown>) => Promise<unknown>;

type ComposioCalendarToolSpec = {
    slug: string;
    label: string;
    description: string;
};

const CALENDAR_TOOLS: ComposioCalendarToolSpec[] = [
    {
        slug: 'GOOGLECALENDAR_EVENTS_LIST_ALL_CALENDARS',
        label: 'List Events From All Calendars',
        description: 'List Google Calendar events across all calendars for a time range.',
    },
    {
        slug: 'GOOGLECALENDAR_EVENTS_LIST',
        label: 'List Calendar Events',
        description: 'List Google Calendar events on a specified calendar, such as primary.',
    },
    {
        slug: 'GOOGLECALENDAR_CREATE_EVENT',
        label: 'Create Calendar Event',
        description: 'Create a Google Calendar event.',
    },
    {
        slug: 'GOOGLECALENDAR_PATCH_EVENT',
        label: 'Patch Calendar Event',
        description: 'Patch selected fields on an existing Google Calendar event.',
    },
    {
        slug: 'GOOGLECALENDAR_UPDATE_EVENT',
        label: 'Update Calendar Event',
        description: 'Update an existing Google Calendar event.',
    },
    {
        slug: 'GOOGLECALENDAR_DELETE_EVENT',
        label: 'Delete Calendar Event',
        description: 'Delete an existing Google Calendar event.',
    },
    {
        slug: 'GOOGLECALENDAR_FIND_EVENT',
        label: 'Find Calendar Event',
        description: 'Find Google Calendar events by query, calendar, and optional time range.',
    },
    {
        slug: 'GOOGLECALENDAR_FIND_FREE_SLOTS',
        label: 'Find Free Slots',
        description: 'Find free and busy slots in Google Calendar for a time range.',
    },
    {
        slug: 'GOOGLECALENDAR_LIST_CALENDARS',
        label: 'List Calendars',
        description: 'List Google Calendars available to the connected user.',
    },
];

function createSdkExecutor(apiKey: string, userId: string): ComposioCalendarExecutor {
    const composio = new Composio({ apiKey });
    return async (slug, args) => composio.tools.execute(slug, { userId, arguments: args });
}

function formatComposioResult(result: unknown): string {
    if (typeof result === 'string') return result;
    return JSON.stringify(result, null, 2);
}

function createComposioCalendarTools(
    config: ComposioCalendarConfig,
    executor?: ComposioCalendarExecutor,
) {
    if (!config.apiKey) return [];

    const userId = config.userId ?? 'default';
    const executeComposio = executor ?? createSdkExecutor(config.apiKey, userId);
    return CALENDAR_TOOLS.map((spec) =>
        defineTool({
            name: `mcp__composio__${spec.slug}`,
            label: spec.label,
            description: `${spec.description} Executes Composio tool ${spec.slug} for configured user "${userId}". Pass Composio action parameters in the arguments object.`,
            parameters: Type.Object({
                arguments: Type.Optional(
                    Type.Object(
                        {},
                        {
                            additionalProperties: true,
                            description: 'Composio action arguments for this Google Calendar tool.',
                        },
                    ),
                ),
            }),
            execute: async (_toolCallId, args) => {
                try {
                    const result = await executeComposio(spec.slug, (args.arguments ?? {}) as Record<string, unknown>);
                    return { content: [{ type: 'text' as const, text: formatComposioResult(result) }], details: {} };
                } catch (err) {
                    const message = err instanceof Error ? err.message : String(err);
                    return { content: [{ type: 'text' as const, text: `Error: ${message}` }], details: {}, isError: true };
                }
            },
        }),
    );
}

export { CALENDAR_TOOLS, createComposioCalendarTools };
export type { ComposioCalendarConfig, ComposioCalendarExecutor };
