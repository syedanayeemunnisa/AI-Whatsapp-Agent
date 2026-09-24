'use strict';

/**
 * Content formatting step (task §28) — normalize common LLM markdown
 * artifacts into WhatsApp-friendly text.
 *
 * WhatsApp supports: *bold*, _italic_, ~strike~, ```monospace```
 * It does NOT support markdown ** **, # headings, or trailing-space line breaks.
 */

function formatForWhatsApp(text) {
  let s = String(text || '');

  // **bold** or __bold__ → *bold*
  s = s.replace(/\*\*([^*\n]+)\*\*/g, '*$1*');
  s = s.replace(/__([^_\n]+)__/g, '*$1*');

  // markdown headings "# Title" → "*Title*"
  s = s.replace(/^#{1,6}\s+(.+)$/gm, '*$1*');

  // trailing double-space markdown line breaks → plain newline
  s = s.replace(/[ \t]+$/gm, '');

  // collapse >2 consecutive blank lines
  s = s.replace(/\n{3,}/g, '\n\n');

  // single backticks are literal noise on WhatsApp → drop them (keep ``` blocks)
  s = s.replace(/(?<!`)`([^`\n]+)`(?!`)/g, '$1');

  return s.trim();
}

module.exports = { formatForWhatsApp };
