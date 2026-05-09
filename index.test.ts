import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createConversationStateStore } from './src/conversation-state.js';

function withTempStorage(runTest) {
  const tempDirectory = mkdtempSync(join(tmpdir(), 'telegram-bot-test-'));
  const conversationDirectoryPath = join(tempDirectory, 'conversations', 'chats');
  const conversationStore = createConversationStateStore({ conversationDirectoryPath });

  return Promise.resolve()
    .then(() => runTest({ conversationDirectoryPath, conversationStore }))
    .finally(() => {
      rmSync(tempDirectory, { force: true, recursive: true });
    });
}

test('conversation store writes a per-chat JSON file', async () => {
  await withTempStorage(async ({ conversationDirectoryPath, conversationStore }) => {
    conversationStore.appendTurn({
      userMessage: 'summarize <this> & that',
      assistantMessage: 'assistant says <ok> & "done"',
      chatId: '42',
      source: 'telegram',
    });

    const transcript = JSON.parse(readFileSync(join(conversationDirectoryPath, '42.json'), 'utf8'));
    assert.equal(transcript.chatId, '42');
    assert.equal(transcript.version, 1);
    assert.equal(transcript.messages.length, 2);
    assert.equal(transcript.messages[0].role, 'user');
    assert.equal(transcript.messages[1].role, 'assistant');
    assert.match(transcript.messages[0].content, /summarize <this> & that/);
    assert.match(transcript.messages[1].content, /assistant says <ok> & "done"/);
  });
});

test('conversation store appends multiple exchanges and survives reload', async () => {
  await withTempStorage(async ({ conversationDirectoryPath, conversationStore }) => {
    conversationStore.appendTurn({
      userMessage: 'first message',
      assistantMessage: 'first reply',
      chatId: '99',
      source: 'telegram',
    });
    const reloadedStore = createConversationStateStore({ conversationDirectoryPath });
    reloadedStore.appendTurn({
      userMessage: 'second message',
      assistantMessage: 'second reply',
      chatId: '99',
      source: 'job:daily-rollover',
    });

    const transcript = JSON.parse(readFileSync(join(conversationDirectoryPath, '99.json'), 'utf8'));
    assert.equal(transcript.messages.length, 4);
    assert.equal(transcript.messages[0].content, 'first message');
    assert.equal(transcript.messages[1].content, 'first reply');
    assert.equal(transcript.messages[2].content, 'second message');
    assert.equal(transcript.messages[3].source, 'job:daily-rollover');
  });
});

test('conversation store trims old messages after append', async () => {
  const tempDirectory = mkdtempSync(join(tmpdir(), 'telegram-bot-test-'));
  const conversationDirectoryPath = join(tempDirectory, 'conversations', 'chats');
  const conversationStore = createConversationStateStore({
    conversationDirectoryPath,
    maxMessages: 3,
  });

  try {
    conversationStore.appendTurn({ chatId: 'trim', userMessage: 'u1', assistantMessage: 'a1', source: 'telegram' });
    conversationStore.appendTurn({ chatId: 'trim', userMessage: 'u2', assistantMessage: 'a2', source: 'telegram' });

    const state = conversationStore.load('trim');
    assert.deepEqual(
      state.messages.map((message) => message.content),
      ['a1', 'u2', 'a2']
    );
  } finally {
    rmSync(tempDirectory, { force: true, recursive: true });
  }
});

test('conversation store buildPrompt includes summary and recent messages', async () => {
  await withTempStorage(async ({ conversationStore }) => {
    conversationStore.save({
      chatId: 'prompt',
      summary: 'User is working on weekly planning.',
      updatedAt: new Date().toISOString(),
      version: 1,
      messages: [
        {
          role: 'user',
          content: 'Move tasks to this week.',
          source: 'telegram',
          createdAt: new Date().toISOString(),
        },
        {
          role: 'assistant',
          content: 'Done, tasks moved.',
          source: 'telegram',
          createdAt: new Date().toISOString(),
        },
      ],
    });

    const prompt = conversationStore.buildPrompt({
      chatId: 'prompt',
      currentInput: 'Please add one more reminder.',
      contextWindow: 2,
    });

    assert.match(prompt, /\[Stored conversation context\]/);
    assert.match(prompt, /Summary: User is working on weekly planning\./);
    assert.match(prompt, /User: Move tasks to this week\./);
    assert.match(prompt, /Assistant: Done, tasks moved\./);
    assert.match(prompt, /Current input:\nPlease add one more reminder\./);
  });
});
