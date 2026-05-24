import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
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

function splitCsv(value: string | undefined): string[] {
    return (value ?? '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
}

function createParentTools(config: ParentToolConfig, dynamicScheduler: DynamicScheduler): ToolDefinition[] {
    const tools: ToolDefinition[] = [];
    const urls = splitCsv(config.icalUrls);
    const composioApiKey = config.composioApiKey ?? config.composioConsumerApiKey;

    if (composioApiKey) {
        tools.push(
            ...createComposioCalendarTools({
                apiKey: composioApiKey,
                userId: config.composioUserId,
            }),
        );
    }

    if (urls.length > 0) {
        tools.push(...createCalendarTools(urls, splitCsv(config.icalLabels)));
    }

    tools.push(...createSchedulerTools(dynamicScheduler));
    return tools;
}

export { createParentTools, splitCsv };
