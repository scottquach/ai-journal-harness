import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { createConversationStateStore, createDefaultState, type ConversationState } from './conversation-state.js';

test('formatRecentMessages via buildPrompt includes HH:MM timestamps in formatted messages', () => {
    process.env.BOT_TIMEZONE = 'America/Chicago';

    const store = createConversationStateStore({
        conversationDirectoryPath: tmpdir(),
    });

    const createdAt = '2026-05-01T14:30:00.000Z';
    const state: ConversationState = {
        ...createDefaultState('test-chat'),
        messages: [
            { role: 'user', content: 'hello', source: 'user', createdAt },
            { role: 'assistant', content: 'hi there', source: 'user', createdAt },
        ],
    };

    store.save(state);
    const prompt = store.buildPrompt({ chatId: 'test-chat', currentInput: 'ping' });

    assert.match(prompt, /\[09:30\]/);
});
