/**
 * Converts standard Markdown to Telegram-compatible HTML.
 *
 * Telegram's HTML parse mode supports: <b>, <i>, <u>, <s>, <code>, <pre>, <a>.
 * This handles the most common Markdown patterns produced by Claude job outputs.
 */
function markdownToTelegramHtml(text: string): string {
  // 1. Escape HTML special characters first
  let result = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // 2. Fenced code blocks (``` ... ```)
  result = result.replace(/```[^\n]*\n?([\s\S]*?)```/g, (_, code) => `<pre>${code.trim()}</pre>`);

  // 3. Inline code (`...`)
  result = result.replace(/`([^`\n]+)`/g, (_, code) => `<code>${code}</code>`);

  // 4. ATX headings (# Heading → <b>Heading</b>)
  result = result.replace(/^#{1,6}\s+(.+)$/gm, (_, heading) => `<b>${heading.trim()}</b>`);

  // 5. Bold — must come before italic to avoid partial matches on **
  result = result.replace(/\*\*([^*\n]+)\*\*/g, (_, t) => `<b>${t}</b>`);
  result = result.replace(/__([^_\n]+)__/g, (_, t) => `<b>${t}</b>`);

  // 6. Italic
  result = result.replace(/\*([^*\n]+)\*/g, (_, t) => `<i>${t}</i>`);
  result = result.replace(/_([^_\n]+)_/g, (_, t) => `<i>${t}</i>`);

  // 7. Markdown links [text](url)
  result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, text, url) => `<a href="${url}">${text}</a>`);

  // 8. Checkboxes
  result = result.replace(/- \[ \]\s/g, '- ⬜ ');
  result = result.replace(/- \[[xX]\]\s/g, '- ✅ ');

  return result;
}

export { markdownToTelegramHtml };
