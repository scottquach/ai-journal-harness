import { message } from 'telegraf/filters';
import type { DispatchTurn } from './dispatch-turn.js';

type BotContext = {
    chat?: { id?: string | number };
    from?: { id?: string | number; username?: string };
    update?: { update_id?: string | number };
    message?: {
        text?: string;
        voice?: {
            file_id: string;
        };
    };
    reply: (text: string, options?: { parse_mode: 'HTML' }) => Promise<unknown> | unknown;
    telegram: {
        getFileLink: (fileId: string) => Promise<{ href: string }>;
    };
};

type BotSetupDeps = {
    dispatchTurn: DispatchTurn;
    transcribeVoice: (ctx: BotContext) => Promise<string>;
};

type TelegramBotLike = {
    catch: (...args: any[]) => unknown;
    on: (...args: any[]) => unknown;
    start: (...args: any[]) => unknown;
    help: (...args: any[]) => unknown;
};

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function getErrorStack(error: unknown): string {
    return error instanceof Error ? error.stack ?? '' : '';
}

function isHandlerTimeoutError(error: unknown): boolean {
    if (!error || typeof error !== 'object') return false;
    const candidate = error as { name?: unknown; message?: unknown };
    return (
        candidate.name === 'TimeoutError' &&
        typeof candidate.message === 'string' &&
        /Promise timed out after \d+ milliseconds/.test(candidate.message)
    );
}

function describeUpdate(ctx: BotContext) {
    return {
        chatId: String(ctx.chat?.id ?? 'global'),
        updateId: ctx.update?.update_id ?? 'unknown',
        userId: ctx.from?.id ?? 'unknown',
    };
}

async function handleMessage(ctx: BotContext, text: string, dispatchTurn: DispatchTurn) {
    const { chatId, updateId } = describeUpdate(ctx);
    const username = ctx.from?.username ?? ctx.from?.id ?? 'unknown';

    console.log(`[message] from user=${username} chatId=${chatId} updateId=${updateId}`);

    await dispatchTurn({
        source: 'telegram',
        chatId,
        input: text,
        deliverTo: chatId,
    });
}

function setupBot(telegramBot: TelegramBotLike, { dispatchTurn, transcribeVoice }: BotSetupDeps): void {
    telegramBot.catch((error: unknown, ctx: BotContext) => {
        const { chatId, updateId, userId } = describeUpdate(ctx);
        const prefix = isHandlerTimeoutError(error) ? '[telegram] handler timeout' : '[telegram] unhandled bot error';
        console.error(
            `${prefix} updateId=${updateId} chatId=${chatId} userId=${userId} error=${getErrorMessage(error)}`,
            getErrorStack(error),
        );
        if (isHandlerTimeoutError(error)) {
            console.error('[telegram] timed-out handler may still be running because Telegraf does not cancel the pending work.');
        }
    });

    telegramBot.on(message('text'), (ctx) => {
        return handleMessage(ctx, ctx.message.text ?? '', dispatchTurn);
    });

    telegramBot.on(message('voice'), async (ctx) => {
        const chatId = String(ctx.chat?.id ?? 'global');
        const username = ctx.from?.username ?? ctx.from?.id ?? 'unknown';
        console.log(`[message] voice received from user=${username} chatId=${chatId}`);

        let transcript;
        try {
            transcript = await transcribeVoice(ctx);
            console.log(
                `[whisper] transcribed voice message="${transcript.slice(0, 100)}${transcript.length > 100 ? '...' : ''}"`,
            );
        } catch (error) {
            console.error(`[whisper] transcription failed error=${getErrorMessage(error)}`);
            await ctx.reply('Failed to transcribe voice message: ' + getErrorMessage(error));
            return;
        }

        await handleMessage(ctx, transcript, dispatchTurn);
    });

    telegramBot.start((ctx) => ctx.reply('Welcome'));
    telegramBot.help((ctx) => ctx.reply("Send me a message and I'll log it to your journal."));
}

export { isHandlerTimeoutError, setupBot };
export type { BotContext, BotSetupDeps, TelegramBotLike };
