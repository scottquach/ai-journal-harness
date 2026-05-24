import 'dotenv/config';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Telegraf } from 'telegraf';
import { loadBotConfig } from './src/bot-config-loader.js';
import { createParentAgentRunner } from './src/parent-agent.js';
import { setupBot } from './src/bot-setup.js';
import { scheduleJobs } from './src/job-scheduler.js';
import { createTranscriber } from './src/transcribe.js';
import { createCalendarTools } from './src/mcp/calendar.js';
import { createDynamicScheduler, type DynamicSchedulerDeps } from './src/dynamic-scheduler.js';
import { createSchedulerTools } from './src/mcp/scheduler.js';
import type { ToolDefinition } from '@earendil-works/pi-coding-agent';

const __dirname = dirname(fileURLToPath(import.meta.url));

const bot = new Telegraf(process.env.BOT_TOKEN as string);
const parent = {
    id: 'parent',
    ...loadBotConfig(join(__dirname, 'agents', 'parent', 'BOT.md'), join(__dirname, 'agents', 'parent', 'prompts')),
};
const schedulerMirrorPath = process.env.VAULT_PATH
    ? join(process.env.VAULT_PATH, 'agent', 'dynamic-schedules.md')
    : undefined;

// dispatchTurn is injected after the runner is created (deferred pattern)
const schedulerDeps: DynamicSchedulerDeps = {
    bot,
    runParentAgent: null,
    defaultChatId: process.env.DEFAULT_CHAT_ID,
    persistPath: join(__dirname, 'schedules', 'dynamic-schedules.json'),
    persistMirrorPath: schedulerMirrorPath,
    timezone: process.env.BOT_TIMEZONE ?? 'America/Chicago',
};
const dynamicScheduler = createDynamicScheduler(schedulerDeps);

const tools: ToolDefinition[] = [];
if (process.env.COMPOSIO_CONSUMER_API_KEY) {
    console.warn('[pi] COMPOSIO_CONSUMER_API_KEY is configured, but Composio MCP is not wired through Pi yet.');
} else if (process.env.ICAL_URLS) {
    const urls = process.env.ICAL_URLS.split(',').map((u) => u.trim()).filter(Boolean);
    const labels = (process.env.ICAL_LABELS || '').split(',').map((l) => l.trim());
    tools.push(...createCalendarTools(urls, labels));
}
tools.push(...createSchedulerTools(dynamicScheduler));
console.log(`[pi] configured tools: ${tools.map((tool) => tool.name).join(', ') || 'none'}`);

const runParentAgent = createParentAgentRunner({ parent, tools });

schedulerDeps.runParentAgent = runParentAgent;
dynamicScheduler.reloadFromDisk();

setupBot(bot, {
    runParentAgent,
    transcribeVoice: createTranscriber(),
});

scheduleJobs(join(__dirname, 'jobs'), {
    runParentAgent,
    telegramSend: (chatId, text, options) => bot.telegram.sendMessage(chatId, text, options),
});

console.log('Bot is running...');
bot.launch();

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
