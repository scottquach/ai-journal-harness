import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

type StoredMessage = {
    role: 'user' | 'assistant';
    content: string;
};

type SimpleMessage = {
    role: 'user' | 'assistant';
    content: string;
};

function historyFilePath(historyDir: string, chatId: string): string {
    return join(historyDir, `${chatId}.json`);
}

function loadMessages(historyDir: string, chatId: string, maxMessages = 50): SimpleMessage[] {
    const path = historyFilePath(historyDir, chatId);
    if (!existsSync(path)) return [];
    try {
        const parsed = JSON.parse(readFileSync(path, 'utf8'));
        if (!Array.isArray(parsed)) return [];
        return (parsed as StoredMessage[]).slice(-maxMessages).map(({ role, content }) => ({ role, content }));
    } catch {
        return [];
    }
}

function appendMessages(historyDir: string, chatId: string, messages: StoredMessage[]): void {
    const path = historyFilePath(historyDir, chatId);
    mkdirSync(dirname(path), { recursive: true });
    let existing: StoredMessage[] = [];
    if (existsSync(path)) {
        try {
            const parsed = JSON.parse(readFileSync(path, 'utf8'));
            if (Array.isArray(parsed)) existing = parsed;
        } catch { /* ignore */ }
    }
    writeFileSync(path, JSON.stringify([...existing, ...messages], null, 2), 'utf8');
}

export { loadMessages, appendMessages };
export type { StoredMessage, SimpleMessage };
