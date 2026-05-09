import 'dotenv/config';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Telegraf } from 'telegraf';
import { loadAgentRegistry } from './src/agent-registry.js';
import { createParentAgentRunner } from './src/parent-agent.js';
import { createConversationStateStore } from './src/conversation-state.js';
import { setupBot } from './src/bot-setup.js';
import { scheduleJobs } from './src/job-scheduler.js';
import { createTranscriber } from './src/transcribe.js';
import { createCalendarServer } from './src/mcp/calendar.js';
import { createDynamicScheduler, type DynamicSchedulerDeps } from './src/dynamic-scheduler.js';
import { createSchedulerServer } from './src/mcp/scheduler.js';
import type { McpServers } from './src/parent-agent.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const bot = new Telegraf(process.env.BOT_TOKEN as string);
const registry = loadAgentRegistry(join(__dirname, 'agents', 'registry.json'));

// runParentAgent is injected after the runner is created (deferred pattern)
const schedulerDeps: DynamicSchedulerDeps = {
    bot,
    runParentAgent: null,
    defaultChatId: process.env.DEFAULT_CHAT_ID,
    persistPath: join(__dirname, 'schedules', 'dynamic-schedules.json'),
    timezone: process.env.BOT_TIMEZONE ?? 'America/Chicago',
};
const dynamicScheduler = createDynamicScheduler(schedulerDeps);

const mcpServers: McpServers = {};
if (process.env.COMPOSIO_CONSUMER_API_KEY) {
    mcpServers.calendar = {
        type: 'http',
        url: 'https://connect.composio.dev/mcp',
        headers: { 'x-consumer-api-key': process.env.COMPOSIO_CONSUMER_API_KEY },
    };
    mcpServers.strava = {
        type: 'http',
        url: 'https://connect.composio.dev/mcp',
        headers: { 'x-consumer-api-key': process.env.COMPOSIO_CONSUMER_API_KEY },
    };
} else if (process.env.ICAL_URLS) {
    const urls = process.env.ICAL_URLS.split(',').map((u) => u.trim()).filter(Boolean);
    const labels = (process.env.ICAL_LABELS || '').split(',').map((l) => l.trim());
    mcpServers.calendar = () => createCalendarServer(urls, labels);
}
mcpServers.scheduler = () => createSchedulerServer(dynamicScheduler);
console.log(`[mcp] configured servers: ${Object.keys(mcpServers).join(', ') || 'none'}`);

const runParentAgent = createParentAgentRunner({
    registry,
    mcpServers: Object.keys(mcpServers).length > 0 ? mcpServers : undefined,
});

schedulerDeps.runParentAgent = runParentAgent;
dynamicScheduler.reloadFromDisk();
const conversationStore = createConversationStateStore();

setupBot(bot, {
    runParentAgent,
    conversationStore,
    transcribeVoice: createTranscriber(),
});

scheduleJobs(bot, join(__dirname, 'jobs'), {
    runParentAgent,
    conversationStore,
});

console.log('Bot is running...');
bot.launch();

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
