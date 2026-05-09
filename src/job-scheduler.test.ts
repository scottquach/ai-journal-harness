import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { loadJobConfigs, parseJobConfig, scheduleJobs, type ConversationStoreLike } from './job-scheduler.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const SAMPLE_JOB_MD = `---
name: daily-summary
cron: "0 9 * * 1-5"
telegram: true
---

Summarize journal entries from the past 24 hours.
`;

test('parseJobConfig extracts name, cron, telegram, and prompt from a job file', () => {
  const job = parseJobConfig(SAMPLE_JOB_MD);
  assert.equal(job.name, 'daily-summary');
  assert.equal(job.cron, '0 9 * * 1-5');
  assert.equal(job.telegram, true);
  assert.match(job.prompt, /Summarize journal entries/);
});

test('parseJobConfig defaults telegram to false when omitted', () => {
  const md = `---\nname: silent-job\ncron: "*/5 * * * *"\n---\n\nDo something quietly.\n`;
  const job = parseJobConfig(md);
  assert.equal(job.telegram, false);
});

test('parseJobConfig throws when name is missing', () => {
  const md = `---\ncron: "0 9 * * *"\n---\n\nPrompt.\n`;
  assert.throws(() => parseJobConfig(md), /name/);
});

test('parseJobConfig throws when cron is missing', () => {
  const md = `---\nname: my-job\n---\n\nPrompt.\n`;
  assert.throws(() => parseJobConfig(md), /cron/);
});

test('parseJobConfig throws when cron expression is invalid', () => {
  const md = `---\nname: bad-job\ncron: "0 9 * *"\n---\n\nPrompt.\n`;
  assert.throws(() => parseJobConfig(md), /invalid cron/);
});

test('weekly reflection is scheduled for Sunday morning', () => {
  const weeklyReflection = readFileSync(
    join(__dirname, '..', 'jobs', 'weekly-reflection.md'),
    'utf8',
  );

  const job = parseJobConfig(weeklyReflection);

  assert.equal(job.cron, '0 8 * * 0');
});

test('loadJobConfigs returns a parsed job config for each .md file in the directory', () => {
  const files: Record<string, string> = {
    'daily-summary.md': `---\nname: daily-summary\ncron: "0 9 * * *"\ntelegram: true\n---\n\nSummarize journal.\n`,
    'silent-job.md': `---\nname: silent-job\ncron: "*/5 * * * *"\n---\n\nDo something.\n`,
  };

  const fakeReaddir = () => Object.keys(files);
  const fakeReadFile = (p: string) => files[basename(p)] ?? '';

  const jobs = loadJobConfigs('/fake/jobs', {
    readdir: fakeReaddir,
    readFile: fakeReadFile,
  });

  assert.equal(jobs.length, 2);
  assert.equal(jobs[0].name, 'daily-summary');
  assert.equal(jobs[1].name, 'silent-job');
});

test('loadJobConfigs ignores non-.md files', () => {
  const fakeReaddir = () => ['job.md', 'README.txt', '.DS_Store'];
  const fakeReadFile = () => `---\nname: job\ncron: "0 * * * *"\n---\n\nPrompt.\n`;

  const jobs = loadJobConfigs('/fake/jobs', {
    readdir: fakeReaddir,
    readFile: fakeReadFile,
  });

  assert.equal(jobs.length, 1);
});

test('loadJobConfigs returns empty array when directory has no .md files', () => {
  const fakeReaddir = () => [];
  const jobs = loadJobConfigs('/fake/jobs', { readdir: fakeReaddir, readFile: () => '' });
  assert.deepEqual(jobs, []);
});

function makeFakeCron() {
  const scheduled: Array<{ expression: string; callback: () => Promise<void> }> = [];
  return {
    schedule(expression: string, callback: () => Promise<void>) {
      scheduled.push({ expression, callback });
    },
    scheduled,
  };
}

function makeFakeBot(chatId = '999') {
  const sent: Array<{ id: string; text: string }> = [];
  return {
    chatId,
    telegram: {
      sendMessage(id: string, text: string) {
        sent.push({ id, text });
        return Promise.resolve();
      },
    },
    sent,
  };
}

test('scheduleJobs throws when runParentAgent is not provided', () => {
  const fakeCron = makeFakeCron();
  assert.throws(
    () => scheduleJobs(makeFakeBot(), '/fake/jobs', {
      cron: fakeCron,
      readdir: () => [],
      readFile: () => '',
    }),
    /runParentAgent/
  );
});

test('scheduleJobs schedules one cron job per job config', () => {
  const files: Record<string, string> = {
    'job-a.md': `---\nname: job-a\ncron: "0 9 * * *"\n---\n\nDo A.\n`,
    'job-b.md': `---\nname: job-b\ncron: "0 18 * * *"\n---\n\nDo B.\n`,
  };
  const fakeCron = makeFakeCron();

  scheduleJobs(makeFakeBot(), '/fake/jobs', {
    cron: fakeCron,
    readdir: () => Object.keys(files),
    readFile: (p) => files[basename(p)] ?? '',
    runParentAgent: async () => ({ output: 'done' }),
  });

  assert.equal(fakeCron.scheduled.length, 2);
  assert.equal(fakeCron.scheduled[0].expression, '0 9 * * *');
  assert.equal(fakeCron.scheduled[1].expression, '0 18 * * *');
});

test('scheduleJobs sends output to Telegram when telegram is true', async () => {
  const files: Record<string, string> = {
    'notify-job.md': `---\nname: notify-job\ncron: "0 9 * * *"\ntelegram: true\n---\n\nDo something.\n`,
  };
  const fakeCron = makeFakeCron();
  const fakeBot = makeFakeBot('42');

  scheduleJobs(fakeBot, '/fake/jobs', {
    cron: fakeCron,
    readdir: () => Object.keys(files),
    readFile: (p) => files[basename(p)] ?? '',
    runParentAgent: async () => ({ output: 'task result' }),
    defaultChatId: '42',
  });

  await fakeCron.scheduled[0].callback();

  assert.equal(fakeBot.sent.length, 1);
  assert.equal(fakeBot.sent[0].id, '42');
  assert.match(fakeBot.sent[0].text, /task result/);
});

test('scheduleJobs does not send to Telegram when telegram is false', async () => {
  const files: Record<string, string> = {
    'silent-job.md': `---\nname: silent-job\ncron: "0 9 * * *"\n---\n\nDo silently.\n`,
  };
  const fakeCron = makeFakeCron();
  const fakeBot = makeFakeBot('42');

  scheduleJobs(fakeBot, '/fake/jobs', {
    cron: fakeCron,
    readdir: () => Object.keys(files),
    readFile: (p) => files[basename(p)] ?? '',
    runParentAgent: async () => ({ output: 'quiet result' }),
    defaultChatId: '42',
  });

  await fakeCron.scheduled[0].callback();

  assert.equal(fakeBot.sent.length, 0);
});

test('scheduleJobs does not send to Telegram when output contains an exact [SKIP] line', async () => {
  const files: Record<string, string> = {
    'skip-job.md': `---\nname: skip-job\ncron: "0 9 * * *"\ntelegram: true\n---\n\nDo something.\n`,
  };
  const fakeCron = makeFakeCron();
  const fakeBot = makeFakeBot('42');

  scheduleJobs(fakeBot, '/fake/jobs', {
    cron: fakeCron,
    readdir: () => Object.keys(files),
    readFile: (p) => files[basename(p)] ?? '',
    runParentAgent: async () => ({ output: 'Checked the context.\n[SKIP]\nNo message needed.' }),
    defaultChatId: '42',
  });

  await fakeCron.scheduled[0].callback();

  assert.equal(fakeBot.sent.length, 0);
});

test('scheduleJobs sends error to Telegram when job fails and telegram is true', async () => {
  const files: Record<string, string> = {
    'failing-job.md': `---\nname: failing-job\ncron: "0 9 * * *"\ntelegram: true\n---\n\nDo something.\n`,
  };
  const fakeCron = makeFakeCron();
  const fakeBot = makeFakeBot('42');

  scheduleJobs(fakeBot, '/fake/jobs', {
    cron: fakeCron,
    readdir: () => Object.keys(files),
    readFile: (p) => files[basename(p)] ?? '',
    runParentAgent: async () => { throw new Error('claude exploded'); },
    defaultChatId: '42',
  });

  await fakeCron.scheduled[0].callback();

  assert.equal(fakeBot.sent.length, 1);
  assert.match(fakeBot.sent[0].text, /failing-job.*failed/i);
  assert.match(fakeBot.sent[0].text, /claude exploded/);
});

test('scheduleJobs uses conversation store prompt context and sends jobs through the parent agent', async () => {
  const files: Record<string, string> = {
    'context-job.md': `---\nname: context-job\ncron: "0 9 * * *"\ntelegram: false\n---\n\nDo something.\n`,
  };
  const fakeCron = makeFakeCron();
  const fakeBot = makeFakeBot('42');
  const calls: any[] = [];
  const fakeStore: ConversationStoreLike = {
    buildPrompt({ chatId, currentInput }) {
      calls.push({ type: 'buildPrompt', chatId, currentInput });
      return `context:\n${currentInput}`;
    },
    appendTurn(payload) {
      calls.push({ type: 'appendTurn', payload });
    },
  };

  scheduleJobs(fakeBot, '/fake/jobs', {
    cron: fakeCron,
    readdir: () => Object.keys(files),
    readFile: (p) => files[basename(p)] ?? '',
    runParentAgent: async ({ chatId, jobName, prompt, source }) => {
      calls.push({ type: 'runParentAgent', chatId, jobName, prompt, source });
      return { output: 'job output' };
    },
    defaultChatId: '42',
    conversationStore: fakeStore,
  });

  await fakeCron.scheduled[0].callback();

  assert.equal(calls[0].type, 'buildPrompt');
  assert.equal(calls[0].chatId, '42');
  assert.equal(calls[1].type, 'runParentAgent');
  assert.equal(calls[1].chatId, '42');
  assert.equal(calls[1].jobName, 'context-job');
  assert.equal(calls[1].source, 'job');
  assert.match(calls[1].prompt, /^context:/);
  assert.equal(calls[2].type, 'appendTurn');
  assert.equal(calls[2].payload.chatId, '42');
  assert.equal(calls[2].payload.source, 'job:context-job');
  assert.equal(calls[2].payload.assistantMessage, 'job output');
});

test('scheduleJobs does not append skipped output to conversation store', async () => {
  const files: Record<string, string> = {
    'skip-job.md': `---\nname: skip-job\ncron: "0 9 * * *"\ntelegram: false\n---\n\nDo something.\n`,
  };
  const fakeCron = makeFakeCron();
  let appended = false;
  const fakeStore: ConversationStoreLike = {
    buildPrompt({ currentInput }) {
      return currentInput;
    },
    appendTurn() {
      appended = true;
    },
  };

  scheduleJobs(makeFakeBot('42'), '/fake/jobs', {
    cron: fakeCron,
    readdir: () => Object.keys(files),
    readFile: (p) => files[basename(p)] ?? '',
    runParentAgent: async () => ({ output: '[SKIP]' }),
    defaultChatId: '42',
    conversationStore: fakeStore,
  });

  await fakeCron.scheduled[0].callback();

  assert.equal(appended, false);
});

test('scheduleJobs does not treat inline [SKIP] mentions as skipped output', async () => {
  const files: Record<string, string> = {
    'notify-job.md': `---\nname: notify-job\ncron: "0 9 * * *"\ntelegram: true\n---\n\nDo something.\n`,
  };
  const fakeCron = makeFakeCron();
  const fakeBot = makeFakeBot('42');

  scheduleJobs(fakeBot, '/fake/jobs', {
    cron: fakeCron,
    readdir: () => Object.keys(files),
    readFile: (p) => files[basename(p)] ?? '',
    runParentAgent: async () => ({ output: 'This mentions [SKIP] but is a real message.' }),
    defaultChatId: '42',
  });

  await fakeCron.scheduled[0].callback();

  assert.equal(fakeBot.sent.length, 1);
});
