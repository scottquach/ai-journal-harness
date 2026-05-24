import 'dotenv/config';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Telegraf } from 'telegraf';
import { loadBotConfig } from './src/bot-config-loader.js';
import { createParentAgentRunner } from './src/parent-agent.js';
import { setupBot } from './src/bot-setup.js';
import { scheduleJobs } from './src/job-scheduler.js';
import { createTranscriber } from './src/transcribe.js';
import { createDynamicScheduler, type DynamicSchedulerDeps } from './src/dynamic-scheduler.js';
import { createParentTools } from './src/parent-tools.js';

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

const tools = await createParentTools(
    {
        composioApiKey: process.env.COMPOSIO_API_KEY,
        composioConsumerApiKey: process.env.COMPOSIO_CONSUMER_API_KEY,
        composioUserId: process.env.COMPOSIO_USER_ID ?? process.env.DEFAULT_CHAT_ID,
        icalLabels: process.env.ICAL_LABELS,
        icalUrls: process.env.ICAL_URLS,
    },
    dynamicScheduler,
);
console.log(`[agent] configured tools: ${Object.keys(tools).join(', ') || 'none'}`);

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
