import type { ParentRunner } from './parent-agent.js';
import type { ConversationStateStore } from './conversation-state.js';
import { isSkipOutput } from './skip-output.js';
import { markdownToTelegramHtml } from './telegram-format.js';

type DispatchSource = 'telegram' | 'job' | 'scheduler';

type ConversationStoreLike = {
    appendTurn: ConversationStateStore['appendTurn'] | ((input: Parameters<ConversationStateStore['appendTurn']>[0]) => unknown);
    buildPrompt: ConversationStateStore['buildPrompt'];
};

type TelegramSend = (
    chatId: string,
    text: string,
    options?: { parse_mode: 'HTML' },
) => Promise<unknown>;

type DispatchTurnInput = {
    source: DispatchSource;
    chatId: string;
    input: string;
    deliverTo?: string | null;
    errorLabel?: string;
    jobName?: string;
};

type DispatchTurnResult = {
    output: string;
    delivered: boolean;
    skipped: boolean;
    error?: Error;
};

type DispatchTurn = (input: DispatchTurnInput) => Promise<DispatchTurnResult>;

type DispatchTurnDeps = {
    runParentAgent: ParentRunner;
    conversationStore: ConversationStoreLike;
    telegramSend: TelegramSend;
};

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function participatesInConversation(source: DispatchSource): boolean {
    return source !== 'scheduler';
}

function checksSkipOutput(source: DispatchSource): boolean {
    return source !== 'telegram';
}

function conversationSourceFor(source: DispatchSource, jobName: string | undefined): string {
    if (source === 'job') return `job:${jobName ?? 'unknown'}`;
    return source;
}

function renderFailureMessage(errorLabel: string | undefined, message: string): string {
    const prefix = errorLabel ? `${errorLabel} failed` : 'Something went wrong';
    return `${prefix}: ${message}`;
}

function createDispatchTurn(deps: DispatchTurnDeps): DispatchTurn {
    return async function dispatchTurn({
        source,
        chatId,
        input,
        deliverTo = null,
        errorLabel,
        jobName,
    }): Promise<DispatchTurnResult> {
        const usesConversation = participatesInConversation(source);
        const usesSkip = checksSkipOutput(source);

        const prompt = usesConversation
            ? deps.conversationStore.buildPrompt({ chatId, currentInput: input })
            : input;

        let output: string;
        try {
            const result = await deps.runParentAgent({ chatId, jobName, prompt, source });
            output = result.output;
        } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            console.error(
                `[dispatch] run failed source=${source} chatId=${chatId} jobName=${jobName ?? 'n/a'} error=${err.message}`,
                err.stack ?? '',
            );
            if (deliverTo) {
                await deps
                    .telegramSend(deliverTo, renderFailureMessage(errorLabel, err.message))
                    .catch((sendErr) => {
                        console.error(`[dispatch] telegram error-send failed: ${getErrorMessage(sendErr)}`);
                    });
            }
            return { output: '', delivered: false, skipped: false, error: err };
        }

        const skipped = usesSkip && isSkipOutput(output);

        if (usesConversation && !skipped) {
            deps.conversationStore.appendTurn({
                assistantMessage: output,
                chatId,
                source: conversationSourceFor(source, jobName),
                userMessage: input,
            });
        }

        let delivered = false;
        if (deliverTo && !skipped) {
            try {
                await deps.telegramSend(deliverTo, markdownToTelegramHtml(output), { parse_mode: 'HTML' });
                delivered = true;
            } catch (err) {
                console.error(`[dispatch] telegram send failed: ${getErrorMessage(err)}`);
            }
        }

        return { output, delivered, skipped };
    };
}

export { createDispatchTurn };
export type {
    ConversationStoreLike,
    DispatchSource,
    DispatchTurn,
    DispatchTurnDeps,
    DispatchTurnInput,
    DispatchTurnResult,
    TelegramSend,
};
