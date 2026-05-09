import assert from 'node:assert/strict';
import test from 'node:test';
import { loadBotConfig, parseFrontmatter } from './bot-config-loader.js';

const SAMPLE_BOT_MD = `---
name: journal
model: haiku
tools:
  - Read
  - Edit
directories:
  - /some/path
---

You are a journal assistant.
`;

// parseFrontmatter tests

test('parseFrontmatter extracts frontmatter object and body', () => {
  const { frontmatter, body } = parseFrontmatter(SAMPLE_BOT_MD);
  assert.equal(frontmatter.name, 'journal');
  assert.equal(frontmatter.model, 'haiku');
  assert.deepEqual(frontmatter.tools, ['Read', 'Edit']);
  assert.deepEqual(frontmatter.directories, ['/some/path']);
  assert.match(body, /You are a journal assistant/);
});

test('parseFrontmatter throws when file does not start with ---', () => {
  assert.throws(() => parseFrontmatter('no frontmatter here'), /frontmatter/i);
});

// loadBotConfig tests

const SIMPLE_BOT_MD = `---
name: librarian
model: haiku
tools:
  - Read
---

Bot instructions here.
`;

test('loadBotConfig loads BOT.md and returns config', () => {
  const files = { '/project/BOT.md': SIMPLE_BOT_MD };
  const readFile = (p) => {
    if (files[p]) return files[p];
    throw Object.assign(new Error(), { code: 'ENOENT' });
  };
  const readdirSync = () => { throw Object.assign(new Error(), { code: 'ENOENT' }); };

  const config = loadBotConfig('/project/BOT.md', '/project/prompts', { readFile, readdirSync });
  assert.equal(config.name, 'librarian');
  assert.equal(config.model, 'haiku');
  assert.deepEqual(config.tools, ['Read']);
  assert.match(config.systemPrompt, /Bot instructions here/);
});

test('loadBotConfig appends supplementary .md files from prompts dir', () => {
  const files = {
    '/project/BOT.md': SIMPLE_BOT_MD,
    '/project/prompts/formatting.md': 'Format rules here.',
  };
  const readFile = (p) => {
    if (files[p]) return files[p];
    throw Object.assign(new Error(), { code: 'ENOENT' });
  };
  const readdirSync = (d) => {
    if (d === '/project/prompts') return ['formatting.md'];
    return [];
  };

  const config = loadBotConfig('/project/BOT.md', '/project/prompts', { readFile, readdirSync });
  assert.match(config.systemPrompt, /Bot instructions here/);
  assert.match(config.systemPrompt, /Format rules here/);
});

test('loadBotConfig prepends CLAUDE.md when it exists', () => {
  const files = {
    '/project/BOT.md': SIMPLE_BOT_MD,
    '/project/CLAUDE.md': 'You are a helpful assistant.',
  };
  const readFile = (p) => {
    if (files[p]) return files[p];
    throw Object.assign(new Error(), { code: 'ENOENT' });
  };
  const readdirSync = () => { throw Object.assign(new Error(), { code: 'ENOENT' }); };

  const config = loadBotConfig('/project/BOT.md', '/project/prompts', { readFile, readdirSync });
  assert.match(config.systemPrompt, /You are a helpful assistant/);
  assert.match(config.systemPrompt, /Bot instructions here/);
  const identityIdx = config.systemPrompt.indexOf('You are a helpful assistant');
  const botIdx = config.systemPrompt.indexOf('Bot instructions here');
  assert.ok(identityIdx < botIdx, 'CLAUDE.md content should precede BOT.md content');
});

test('loadBotConfig works without CLAUDE.md or prompts dir', () => {
  const files = { '/project/BOT.md': SIMPLE_BOT_MD };
  const readFile = (p) => {
    if (files[p]) return files[p];
    throw Object.assign(new Error(), { code: 'ENOENT' });
  };
  const readdirSync = () => { throw Object.assign(new Error(), { code: 'ENOENT' }); };

  const config = loadBotConfig('/project/BOT.md', '/project/prompts', { readFile, readdirSync });
  assert.match(config.systemPrompt, /Bot instructions here/);
});

test('loadBotConfig expands env vars in directories and systemPrompt', () => {
  const botMd = `---
name: journal
model: haiku
directories:
  - \${VAULT_PATH}
---

Files live at \${VAULT_PATH}/Journal.
`;
  const files = { '/project/BOT.md': botMd };
  const readFile = (p) => {
    if (files[p]) return files[p];
    throw Object.assign(new Error(), { code: 'ENOENT' });
  };
  const readdirSync = () => { throw Object.assign(new Error(), { code: 'ENOENT' }); };
  const env = { VAULT_PATH: '/my/vault' };

  const config = loadBotConfig('/project/BOT.md', '/project/prompts', { readFile, readdirSync, env });
  assert.deepEqual(config.directories, ['/my/vault']);
  assert.match(config.systemPrompt, /\/my\/vault\/Journal/);
});
