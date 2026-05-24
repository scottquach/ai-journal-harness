import { Composio } from '@composio/core';
import { VercelProvider } from '@composio/vercel';
import type { Tool } from 'ai';

type ComposioCalendarConfig = {
    apiKey?: string;
    userId?: string;
};

async function createComposioCalendarTools(
    config: ComposioCalendarConfig,
): Promise<Record<string, Tool<any, any>>> {
    if (!config.apiKey) return {};

    console.log("API KEY", config.apiKey)
    const composio = new Composio({
        apiKey: config.apiKey,
        provider: new VercelProvider(),
    });

    const userId = config.userId ?? 'default';
    return (await composio.tools.get(userId, { toolkits: ['googlecalendar'] })) as Record<string, Tool<any, any>>;
}

export { createComposioCalendarTools };
export type { ComposioCalendarConfig };
