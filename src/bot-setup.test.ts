import assert from 'node:assert/strict';
import test from 'node:test';
import { isHandlerTimeoutError, setupBot, type BotContext } from './bot-setup.js';

type CatchHandler = (error: unknown, ctx: BotContext) => void;
type BotHandler = (ctx: BotContext) => unknown;

test('isHandlerTimeoutError recognizes Telegraf handler timeout errors', () => {
    assert.equal(
        isHandlerTimeoutError({ name: 'TimeoutError', message: 'Promise timed out after 90000 milliseconds' }),
        true,
    );
    assert.equal(
        isHandlerTimeoutError({ name: 'Error', message: 'Promise timed out after 90000 milliseconds' }),
        false,
    );
    assert.equal(
        isHandlerTimeoutError({ name: 'TimeoutError', message: 'Something else happened' }),
        false,
    );
});

test('setupBot registers a bot.catch handler that logs timeout context', async () => {
    const registrations: {
        catch: CatchHandler | null;
        handlers: Map<unknown, BotHandler>;
        start: BotHandler | null;
        help: BotHandler | null;
    } = { catch: null, handlers: new Map(), start: null, help: null };
    const telegramBot = {
        catch(handler: CatchHandler) {
            registrations.catch = handler;
        },
        on(filter: unknown, handler: BotHandler) {
            registrations.handlers.set(filter, handler);
        },
        start(handler: BotHandler) {
            registrations.start = handler;
        },
        help(handler: BotHandler) {
            registrations.help = handler;
        },
    };

    setupBot(telegramBot, {
        runParentAgent: async () => ({ output: 'ok' }),
        conversationStore: { buildPrompt: () => '', appendTurn: () => {} },
        transcribeVoice: async () => 'voice',
    });

    assert.equal(typeof registrations.catch, 'function');
    assert.equal(registrations.handlers.size, 2);
    assert.equal(typeof registrations.start, 'function');
    assert.equal(typeof registrations.help, 'function');

    const calls: string[] = [];
    const originalConsoleError = console.error;
    console.error = (...args) => calls.push(args.join(' '));

    try {
        assert.ok(registrations.catch);
        registrations.catch(
            { name: 'TimeoutError', message: 'Promise timed out after 90000 milliseconds', stack: 'stacktrace' },
            {
                chat: { id: 42 },
                from: { id: 7 },
                update: { update_id: 99 },
            } as BotContext,
        );
    } finally {
        console.error = originalConsoleError;
    }

    assert.equal(calls.length, 2);
    assert.match(calls[0], /\[telegram\] handler timeout/);
    assert.match(calls[0], /updateId=99/);
    assert.match(calls[0], /chatId=42/);
    assert.match(calls[0], /userId=7/);
    assert.match(calls[1], /may still be running/);
});
