import type { Tool } from 'ai';
import { createComposioCalendarTools } from './mcp/composio-calendar.js';
import { createCalendarTools } from './mcp/calendar.js';
import { createSchedulerTools } from './mcp/scheduler.js';
import type { DynamicScheduler } from './dynamic-scheduler.js';

type ParentToolConfig = {
    composioApiKey?: string;
    composioConsumerApiKey?: string;
    composioUserId?: string;
    icalUrls?: string;
    icalLabels?: string;
};

type ParentTools = Record<string, Tool<any, any>>;

function splitCsv(value: string | undefined): string[] {
    return (value ?? '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
}

function createParentTools(config: ParentToolConfig, dynamicScheduler: DynamicScheduler): ParentTools {
    const tools: ParentTools = {};
    const composioApiKey = config.composioApiKey ?? config.composioConsumerApiKey;

    if (composioApiKey) {
        Object.assign(
            tools,
            createComposioCalendarTools({
                apiKey: composioApiKey,
                userId: config.composioUserId,
            }),
        );
    }

    // Only add iCal fallback when Composio is not configured (avoids getCalendarEvents name collision)
    if (!composioApiKey) {
        const urls = splitCsv(config.icalUrls);
        if (urls.length > 0) {
            Object.assign(tools, createCalendarTools(urls, splitCsv(config.icalLabels)));
        }
    }

    Object.assign(tools, createSchedulerTools(dynamicScheduler));

    return tools;
}

export { createParentTools, splitCsv };
export type { ParentToolConfig, ParentTools };
