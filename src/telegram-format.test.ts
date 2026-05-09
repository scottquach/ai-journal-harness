import assert from 'node:assert/strict';
import test from 'node:test';
import { markdownToTelegramHtml } from './telegram-format.js';

test('passes plain text through unchanged', () => {
  assert.equal(markdownToTelegramHtml('hello world'), 'hello world');
});

test('escapes HTML special characters', () => {
  assert.equal(markdownToTelegramHtml('a & b < c > d'), 'a &amp; b &lt; c &gt; d');
});

test('converts ## heading to <b>', () => {
  assert.equal(markdownToTelegramHtml('## My Heading'), '<b>My Heading</b>');
});

test('converts # heading to <b>', () => {
  assert.equal(markdownToTelegramHtml('# Title'), '<b>Title</b>');
});

test('converts **bold** to <b>', () => {
  assert.equal(markdownToTelegramHtml('**bold text**'), '<b>bold text</b>');
});

test('converts __bold__ to <b>', () => {
  assert.equal(markdownToTelegramHtml('__bold text__'), '<b>bold text</b>');
});

test('converts *italic* to <i>', () => {
  assert.equal(markdownToTelegramHtml('*italic text*'), '<i>italic text</i>');
});

test('converts _italic_ to <i>', () => {
  assert.equal(markdownToTelegramHtml('_italic text_'), '<i>italic text</i>');
});

test('converts inline `code` to <code>', () => {
  assert.equal(markdownToTelegramHtml('run `npm test` now'), 'run <code>npm test</code> now');
});

test('converts fenced code block to <pre>', () => {
  const input = '```\nconst x = 1;\n```';
  assert.equal(markdownToTelegramHtml(input), '<pre>const x = 1;</pre>');
});

test('converts mixed heading and bold on same line', () => {
  const input = '## **Overall vibe:** Recovering from jet lag';
  assert.equal(markdownToTelegramHtml(input), '<b><b>Overall vibe:</b> Recovering from jet lag</b>');
});

test('handles bullet list with inline bold', () => {
  const input = '- **Recovery:** doing well';
  assert.equal(markdownToTelegramHtml(input), '- <b>Recovery:</b> doing well');
});

test('leaves bullet dashes and newlines intact', () => {
  const input = '- item one\n- item two';
  assert.equal(markdownToTelegramHtml(input), '- item one\n- item two');
});

test('converts markdown link to <a> tag', () => {
  assert.equal(
    markdownToTelegramHtml('See [Google](https://google.com) for more'),
    'See <a href="https://google.com">Google</a> for more',
  );
});

test('converts unchecked checkbox to ⬜', () => {
  assert.equal(markdownToTelegramHtml('- [ ] Buy groceries'), '- ⬜ Buy groceries');
});

test('converts checked checkbox to ✅', () => {
  assert.equal(markdownToTelegramHtml('- [x] Buy groceries'), '- ✅ Buy groceries');
});

test('converts uppercase [X] checkbox to ✅', () => {
  assert.equal(markdownToTelegramHtml('- [X] Done task'), '- ✅ Done task');
});
