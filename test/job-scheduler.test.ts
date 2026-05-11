import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { loadJobConfigs, parseJobConfig, scheduleJobs } from '../src/job-scheduler.js';
import type { DispatchTurn } from '../src/dispatch-turn.js';

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

test('scheduleJobs throws when dispatchTurn is not provided', () => {
  const fakeCron = makeFakeCron();
  assert.throws(
    () => scheduleJobs('/fake/jobs', {
      cron: fakeCron,
      readdir: () => [],
      readFile: () => '',
    } as unknown as Parameters<typeof scheduleJobs>[1]),
    /dispatchTurn/,
  );
});

test('scheduleJobs schedules one cron job per job config', () => {
  const files: Record<string, string> = {
    'job-a.md': `---\nname: job-a\ncron: "0 9 * * *"\n---\n\nDo A.\n`,
    'job-b.md': `---\nname: job-b\ncron: "0 18 * * *"\n---\n\nDo B.\n`,
  };
  const fakeCron = makeFakeCron();
  const dispatchTurn: DispatchTurn = async () => ({ output: 'x', delivered: false, skipped: false });

  scheduleJobs('/fake/jobs', {
    cron: fakeCron,
    readdir: () => Object.keys(files),
    readFile: (p) => files[basename(p)] ?? '',
    dispatchTurn,
  });

  assert.equal(fakeCron.scheduled.length, 2);
  assert.equal(fakeCron.scheduled[0].expression, '0 9 * * *');
  assert.equal(fakeCron.scheduled[1].expression, '0 18 * * *');
});

test('scheduleJobs forwards job invocations to dispatchTurn with the right metadata', async () => {
  const files: Record<string, string> = {
    'notify-job.md': `---\nname: notify-job\ncron: "0 9 * * *"\ntelegram: true\n---\n\nDo the thing.\n`,
    'silent-job.md': `---\nname: silent-job\ncron: "0 18 * * *"\n---\n\nDo it quietly.\n`,
  };
  const fakeCron = makeFakeCron();
  const calls: Parameters<DispatchTurn>[0][] = [];
  const dispatchTurn: DispatchTurn = async (input) => {
    calls.push(input);
    return { output: 'ok', delivered: true, skipped: false };
  };

  scheduleJobs('/fake/jobs', {
    cron: fakeCron,
    readdir: () => Object.keys(files),
    readFile: (p) => files[basename(p)] ?? '',
    dispatchTurn,
    defaultChatId: '42',
  });

  await fakeCron.scheduled[0].callback();
  await fakeCron.scheduled[1].callback();

  assert.equal(calls.length, 2);

  assert.equal(calls[0].source, 'job');
  assert.equal(calls[0].chatId, '42');
  assert.equal(calls[0].jobName, 'notify-job');
  assert.equal(calls[0].deliverTo, '42');
  assert.equal(calls[0].errorLabel, 'Job "notify-job"');
  assert.match(calls[0].input, /Do the thing/);

  assert.equal(calls[1].jobName, 'silent-job');
  assert.equal(calls[1].deliverTo, null);
});
