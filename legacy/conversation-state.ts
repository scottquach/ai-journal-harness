import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildContextString, computeDateContext } from './date-context.js';

const CONVERSATION_STATE_VERSION = 1;
const DEFAULT_MAX_MESSAGES = 40;
const DEFAULT_CONTEXT_WINDOW = 8;
const DEFAULT_CONVERSATION_DIRECTORY_PATH = join(
    dirname(fileURLToPath(import.meta.url)),
    '..',
    'conversations',
    'chats',
);

type ConversationRole = 'user' | 'assistant';

type ConversationMessage = {
    content: string;
    createdAt: string;
    role: ConversationRole;
    source: string;
};

type ConversationState = {
    chatId: string;
    messages: ConversationMessage[];
    summary: string;
    updatedAt: string;
    version: typeof CONVERSATION_STATE_VERSION;
};

type ConversationStoreOptions = {
    conversationDirectoryPath?: string;
    maxMessages?: number;
    readFile?: (path: string, encoding: BufferEncoding) => string;
    writeFile?: (path: string, data: string, encoding: BufferEncoding) => void;
    renameFile?: (oldPath: string, newPath: string) => void;
    createDirectory?: (path: string, options: { recursive: boolean }) => void;
};

type AppendTurnInput = {
    assistantMessage: string;
    chatId: string | number;
    source?: string;
    userMessage: string;
};

type BuildPromptInput = {
    chatId: string | number;
    currentInput: string;
    contextWindow?: number;
};

type ConversationStateStore = {
    appendTurn: (input: AppendTurnInput) => ConversationState;
    buildPrompt: (input: BuildPromptInput) => string;
    load: (chatId: string | number) => ConversationState;
    save: (state: ConversationState) => ConversationState;
    trimMessages: (messages: ConversationMessage[], maxMessages?: number) => ConversationMessage[];
};

function toSafeFileName(chatId: string | number): string {
    return encodeURIComponent(String(chatId));
}

function getConversationStatePath({
    chatId,
    conversationDirectoryPath,
}: {
    chatId: string | number;
    conversationDirectoryPath: string;
}): string {
    return join(conversationDirectoryPath, `${toSafeFileName(chatId)}.json`);
}

function createDefaultState(chatId: string | number): ConversationState {
    return {
        chatId: String(chatId),
        messages: [],
        summary: '',
        updatedAt: new Date().toISOString(),
        version: CONVERSATION_STATE_VERSION,
    };
}

function normalizeMessage(message: unknown): ConversationMessage | null {
    if (!message || typeof message !== 'object') return null;

    const candidate = message as Partial<ConversationMessage>;
    if (candidate.role !== 'user' && candidate.role !== 'assistant') return null;
    if (typeof candidate.content !== 'string') return null;

    return {
        content: candidate.content,
        createdAt: typeof candidate.createdAt === 'string' ? candidate.createdAt : new Date().toISOString(),
        role: candidate.role,
        source: typeof candidate.source === 'string' ? candidate.source : 'unknown',
    };
}

function normalizeState(chatId: string | number, raw: unknown): ConversationState {
    const fallback = createDefaultState(chatId);
    if (!raw || typeof raw !== 'object') return fallback;

    const candidate = raw as Partial<ConversationState>;
    const messages = Array.isArray(candidate.messages)
        ? candidate.messages.map(normalizeMessage).filter((message): message is ConversationMessage => Boolean(message))
        : [];
    const summary = typeof candidate.summary === 'string' ? candidate.summary : '';

    return {
        chatId: typeof candidate.chatId === 'string' ? candidate.chatId : String(chatId),
        messages,
        summary,
        updatedAt: typeof candidate.updatedAt === 'string' ? candidate.updatedAt : new Date().toISOString(),
        version: CONVERSATION_STATE_VERSION,
    };
}

function trimMessages(messages: ConversationMessage[], maxMessages = DEFAULT_MAX_MESSAGES): ConversationMessage[] {
    if (!Array.isArray(messages)) return [];
    if (messages.length <= maxMessages) return messages;
    return messages.slice(messages.length - maxMessages);
}

function formatRecentMessages(messages: ConversationMessage[]): string {
    if (messages.length === 0) return '- (none)';
    return messages
        .map((message) => {
            const roleLabel = message.role === 'assistant' ? 'Assistant' : 'User';
            const time = message.createdAt
                ? new Intl.DateTimeFormat('en-GB', {
                      timeZone: process.env.BOT_TIMEZONE ?? 'America/Chicago',
                      hour: '2-digit',
                      minute: '2-digit',
                      hour12: false,
                  }).format(new Date(message.createdAt))
                : '--:--';
            return `- [${time}] ${roleLabel}: ${message.content}`;
        })
        .join('\n');
}

function buildContextBlock(
    state: ConversationState,
    { contextWindow = DEFAULT_CONTEXT_WINDOW }: { contextWindow?: number } = {},
): string {
    const recentMessages = trimMessages(state.messages, contextWindow);
    const summary = state.summary.trim().length > 0 ? state.summary.trim() : '(none)';

    return [
        '[Stored conversation context]',
        `Summary: ${summary}`,
        'Recent messages:',
        formatRecentMessages(recentMessages),
        '[/Stored conversation context]',
    ].join('\n');
}

function createConversationStateStore({
    conversationDirectoryPath = DEFAULT_CONVERSATION_DIRECTORY_PATH,
    maxMessages = DEFAULT_MAX_MESSAGES,
    readFile = readFileSync,
    writeFile = writeFileSync,
    renameFile = renameSync,
    createDirectory = mkdirSync,
}: ConversationStoreOptions = {}): ConversationStateStore {
    function load(chatId: string | number): ConversationState {
        const statePath = getConversationStatePath({ chatId, conversationDirectoryPath });
        try {
            const rawText = readFile(statePath, 'utf8');
            const parsed = JSON.parse(rawText);
            return normalizeState(chatId, parsed);
        } catch (error) {
            if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
                return createDefaultState(chatId);
            }
            if (error instanceof SyntaxError) return createDefaultState(chatId);
            throw error;
        }
    }

    function save(state: ConversationState): ConversationState {
        const chatId = state.chatId;
        const statePath = getConversationStatePath({ chatId, conversationDirectoryPath });
        const tempPath = `${statePath}.tmp`;
        const normalized = normalizeState(chatId, state);
        const nextState = {
            ...normalized,
            messages: trimMessages(normalized.messages, maxMessages),
            updatedAt: new Date().toISOString(),
        };

        createDirectory(dirname(statePath), { recursive: true });
        writeFile(tempPath, JSON.stringify(nextState, null, 2), 'utf8');
        renameFile(tempPath, statePath);
        return nextState;
    }

    function appendTurn({ assistantMessage, chatId, source = 'unknown', userMessage }: AppendTurnInput): ConversationState {
        const state = load(chatId);
        state.messages.push(
            { content: userMessage, createdAt: new Date().toISOString(), role: 'user', source },
            { content: assistantMessage, createdAt: new Date().toISOString(), role: 'assistant', source },
        );
        return save(state);
    }

    function buildPrompt({ chatId, currentInput, contextWindow = DEFAULT_CONTEXT_WINDOW }: BuildPromptInput): string {
        const state = load(chatId);
        const contextBlock = buildContextBlock(state, { contextWindow });

        const { today, weekNum, year } = computeDateContext();
        const weekNumPadded = String(weekNum).padStart(2, '0');
        const dateContext = buildContextString({
            day_header: `## [[${today}]]`,
            weekly_note: `Journal/${year}-W${weekNumPadded}.md`,
            monthly_note: `Journal/${today.slice(0, 7)}.md`,
        });

        return `${dateContext}\n\n${contextBlock}\n\nCurrent input:\n${currentInput}`;
    }

    return {
        appendTurn,
        buildPrompt,
        load,
        save,
        trimMessages,
    };
}

export {
    type AppendTurnInput,
    CONVERSATION_STATE_VERSION,
    type BuildPromptInput,
    type ConversationMessage,
    type ConversationState,
    type ConversationStateStore,
    type ConversationStoreOptions,
    DEFAULT_CONTEXT_WINDOW,
    DEFAULT_MAX_MESSAGES,
    createConversationStateStore,
    createDefaultState,
    trimMessages,
};
