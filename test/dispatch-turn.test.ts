import assert from 'node:assert/strict';
import test from 'node:test';
import { createDispatchTurn, type ConversationStoreLike, type TelegramSend } from '../src/dispatch-turn.js';

type StoreCall =
    | { type: 'buildPrompt'; chatId: string | number; currentInput: string }
    | { type: 'appendTurn'; payload: { chatId: string | number; userMessage: string; assistantMessage: string; source?: string } };

type SendCall = { chatId: string; text: string; html: boolean };

type ParentCall = { chatId?: string; jobName?: string; prompt?: string; source?: string };

function makeFakes(opts: {
    parentOutput?: string;
    parentThrows?: Error;
    sendThrows?: Error;
} = {}) {
    const storeCalls: StoreCall[] = [];
    const sendCalls: SendCall[] = [];
    const parentCalls: ParentCall[] = [];

    const conversationStore: ConversationStoreLike = {
        buildPrompt({ chatId, currentInput }) {
            storeCalls.push({ type: 'buildPrompt', chatId, currentInput });
            return `prompt-with-context:${currentInput}`;
        },
        appendTurn(payload) {
            storeCalls.push({ type: 'appendTurn', payload });
        },
    };

    const telegramSend: TelegramSend = async (chatId, text, options) => {
        if (opts.sendThrows) throw opts.sendThrows;
        sendCalls.push({ chatId, text, html: options?.parse_mode === 'HTML' });
        return undefined;
    };

    const runParentAgent = (async (input?: ParentCall) => {
        parentCalls.push(input ?? {});
        if (opts.parentThrows) throw opts.parentThrows;
        return { loadedSkills: [], output: opts.parentOutput ?? 'agent output' };
    }) as Parameters<typeof createDispatchTurn>[0]['runParentAgent'];

    return { conversationStore, telegramSend, runParentAgent, storeCalls, sendCalls, parentCalls };
}

test('telegram source builds prompt, appends turn, always delivers', async () => {
    const fakes = makeFakes({ parentOutput: 'hello back' });
    const dispatch = createDispatchTurn({
        runParentAgent: fakes.runParentAgent,
        conversationStore: fakes.conversationStore,
        telegramSend: fakes.telegramSend,
    });

    const result = await dispatch({
        source: 'telegram',
        chatId: '42',
        input: 'hello',
        deliverTo: '42',
    });

    assert.deepEqual(result, { output: 'hello back', delivered: true, skipped: false });
    assert.equal(fakes.storeCalls[0].type, 'buildPrompt');
    assert.equal(fakes.parentCalls[0].prompt, 'prompt-with-context:hello');
    assert.equal(fakes.parentCalls[0].source, 'telegram');
    assert.equal(fakes.storeCalls[1].type, 'appendTurn');
    assert.deepEqual(fakes.storeCalls[1].type === 'appendTurn' && fakes.storeCalls[1].payload, {
        chatId: '42',
        userMessage: 'hello',
        assistantMessage: 'hello back',
        source: 'telegram',
    });
    assert.equal(fakes.sendCalls.length, 1);
    assert.equal(fakes.sendCalls[0].chatId, '42');
    assert.equal(fakes.sendCalls[0].html, true);
});

test('telegram source delivers even when output looks like a [SKIP]', async () => {
    const fakes = makeFakes({ parentOutput: '[SKIP]' });
    const dispatch = createDispatchTurn({
        runParentAgent: fakes.runParentAgent,
        conversationStore: fakes.conversationStore,
        telegramSend: fakes.telegramSend,
    });

    const result = await dispatch({
        source: 'telegram',
        chatId: '42',
        input: 'hi',
        deliverTo: '42',
    });

    assert.equal(result.skipped, false);
    assert.equal(result.delivered, true);
    assert.equal(fakes.sendCalls.length, 1);
});

test('job source builds prompt, appends with job-tagged source, delivers when deliverTo set', async () => {
    const fakes = makeFakes({ parentOutput: 'job output' });
    const dispatch = createDispatchTurn({
        runParentAgent: fakes.runParentAgent,
        conversationStore: fakes.conversationStore,
        telegramSend: fakes.telegramSend,
    });

    const result = await dispatch({
        source: 'job',
        chatId: '42',
        input: 'do the thing',
        deliverTo: '42',
        jobName: 'weekly-review',
    });

    assert.equal(result.delivered, true);
    assert.equal(fakes.parentCalls[0].source, 'job');
    assert.equal(fakes.parentCalls[0].jobName, 'weekly-review');
    const append = fakes.storeCalls.find((c) => c.type === 'appendTurn');
    assert.ok(append && append.type === 'appendTurn');
    assert.equal(append.payload.source, 'job:weekly-review');
});

test('job source with deliverTo=null still appends but does not send', async () => {
    const fakes = makeFakes({ parentOutput: 'silent job output' });
    const dispatch = createDispatchTurn({
        runParentAgent: fakes.runParentAgent,
        conversationStore: fakes.conversationStore,
        telegramSend: fakes.telegramSend,
    });

    const result = await dispatch({
        source: 'job',
        chatId: '42',
        input: 'silent',
        deliverTo: null,
        jobName: 'silent-job',
    });

    assert.equal(result.delivered, false);
    assert.equal(result.skipped, false);
    assert.equal(fakes.sendCalls.length, 0);
    assert.ok(fakes.storeCalls.some((c) => c.type === 'appendTurn'));
});

test('job source skips append and delivery on [SKIP] output', async () => {
    const fakes = makeFakes({ parentOutput: 'Did stuff.\n[SKIP]\nNothing to say.' });
    const dispatch = createDispatchTurn({
        runParentAgent: fakes.runParentAgent,
        conversationStore: fakes.conversationStore,
        telegramSend: fakes.telegramSend,
    });

    const result = await dispatch({
        source: 'job',
        chatId: '42',
        input: 'maybe',
        deliverTo: '42',
        jobName: 'maybe-job',
    });

    assert.equal(result.skipped, true);
    assert.equal(result.delivered, false);
    assert.equal(fakes.sendCalls.length, 0);
    assert.equal(fakes.storeCalls.filter((c) => c.type === 'appendTurn').length, 0);
});

test('job source does not treat inline [SKIP] mentions as skipped', async () => {
    const fakes = makeFakes({ parentOutput: 'This mentions [SKIP] but is a real message.' });
    const dispatch = createDispatchTurn({
        runParentAgent: fakes.runParentAgent,
        conversationStore: fakes.conversationStore,
        telegramSend: fakes.telegramSend,
    });

    const result = await dispatch({
        source: 'job',
        chatId: '42',
        input: 'q',
        deliverTo: '42',
        jobName: 'j',
    });

    assert.equal(result.skipped, false);
    assert.equal(result.delivered, true);
});

test('scheduler source bypasses conversation store, delivers raw input as prompt', async () => {
    const fakes = makeFakes({ parentOutput: 'scheduled output' });
    const dispatch = createDispatchTurn({
        runParentAgent: fakes.runParentAgent,
        conversationStore: fakes.conversationStore,
        telegramSend: fakes.telegramSend,
    });

    const result = await dispatch({
        source: 'scheduler',
        chatId: '42',
        input: 'run me',
        deliverTo: '42',
        jobName: 'sched-1',
    });

    assert.equal(result.delivered, true);
    assert.equal(fakes.storeCalls.length, 0);
    assert.equal(fakes.parentCalls[0].prompt, 'run me');
    assert.equal(fakes.parentCalls[0].source, 'scheduler');
});

test('scheduler source suppresses delivery on [SKIP]', async () => {
    const fakes = makeFakes({ parentOutput: '[SKIP]' });
    const dispatch = createDispatchTurn({
        runParentAgent: fakes.runParentAgent,
        conversationStore: fakes.conversationStore,
        telegramSend: fakes.telegramSend,
    });

    const result = await dispatch({
        source: 'scheduler',
        chatId: 'global',
        input: 'p',
        deliverTo: '42',
    });

    assert.equal(result.skipped, true);
    assert.equal(result.delivered, false);
    assert.equal(fakes.sendCalls.length, 0);
});

test('scheduler source with deliverTo=null still runs the agent but does not send', async () => {
    const fakes = makeFakes({ parentOutput: 'orphaned output' });
    const dispatch = createDispatchTurn({
        runParentAgent: fakes.runParentAgent,
        conversationStore: fakes.conversationStore,
        telegramSend: fakes.telegramSend,
    });

    const result = await dispatch({
        source: 'scheduler',
        chatId: 'global',
        input: 'p',
        deliverTo: null,
    });

    assert.equal(result.delivered, false);
    assert.equal(fakes.parentCalls.length, 1);
    assert.equal(fakes.sendCalls.length, 0);
});

test('agent failure routes user-visible error via errorLabel when present', async () => {
    const fakes = makeFakes({ parentThrows: new Error('claude exploded') });
    const dispatch = createDispatchTurn({
        runParentAgent: fakes.runParentAgent,
        conversationStore: fakes.conversationStore,
        telegramSend: fakes.telegramSend,
    });

    const originalConsoleError = console.error;
    console.error = () => {};
    let result;
    try {
        result = await dispatch({
            source: 'job',
            chatId: '42',
            input: 'p',
            deliverTo: '42',
            errorLabel: 'Job "failing-job"',
            jobName: 'failing-job',
        });
    } finally {
        console.error = originalConsoleError;
    }

    assert.ok(result.error);
    assert.equal(result.delivered, false);
    assert.equal(fakes.sendCalls.length, 1);
    assert.match(fakes.sendCalls[0].text, /^Job "failing-job" failed: claude exploded$/);
    assert.equal(fakes.sendCalls[0].html, false);
});

test('agent failure on telegram source uses the "Something went wrong" fallback', async () => {
    const fakes = makeFakes({ parentThrows: new Error('boom') });
    const dispatch = createDispatchTurn({
        runParentAgent: fakes.runParentAgent,
        conversationStore: fakes.conversationStore,
        telegramSend: fakes.telegramSend,
    });

    const originalConsoleError = console.error;
    console.error = () => {};
    try {
        await dispatch({
            source: 'telegram',
            chatId: '42',
            input: 'p',
            deliverTo: '42',
        });
    } finally {
        console.error = originalConsoleError;
    }

    assert.equal(fakes.sendCalls.length, 1);
    assert.match(fakes.sendCalls[0].text, /^Something went wrong: boom$/);
});

test('agent failure with deliverTo=null logs but does not send', async () => {
    const fakes = makeFakes({ parentThrows: new Error('quiet failure') });
    const dispatch = createDispatchTurn({
        runParentAgent: fakes.runParentAgent,
        conversationStore: fakes.conversationStore,
        telegramSend: fakes.telegramSend,
    });

    const originalConsoleError = console.error;
    console.error = () => {};
    try {
        const result = await dispatch({
            source: 'scheduler',
            chatId: 'global',
            input: 'p',
            deliverTo: null,
        });
        assert.ok(result.error);
    } finally {
        console.error = originalConsoleError;
    }
    assert.equal(fakes.sendCalls.length, 0);
});

test('telegram send failure on success path is caught and surfaced as delivered=false', async () => {
    const fakes = makeFakes({ parentOutput: 'ok', sendThrows: new Error('network down') });
    const dispatch = createDispatchTurn({
        runParentAgent: fakes.runParentAgent,
        conversationStore: fakes.conversationStore,
        telegramSend: fakes.telegramSend,
    });

    const originalConsoleError = console.error;
    console.error = () => {};
    try {
        const result = await dispatch({
            source: 'job',
            chatId: '42',
            input: 'p',
            deliverTo: '42',
            jobName: 'j',
        });
        assert.equal(result.delivered, false);
        assert.equal(result.skipped, false);
        // Append still happens — conversation state shouldn't depend on send success.
        assert.ok(fakes.storeCalls.some((c) => c.type === 'appendTurn'));
    } finally {
        console.error = originalConsoleError;
    }
});
