'use strict';

/**
 * Content validation before content is accepted/sent (task §46; extended in Phase 4 §53).
 *
 * Checks:
 *   - non-empty, length bounds
 *   - no prompt/instruction leakage
 *   - no placeholder text
 *   - (Phase 4) no fabricated statistics ("studies show 73%…")
 *   - (Phase 4) no personal contact info (emails/phones) — the agent must never invite DMs
 *   - (Phase 4) no raw links in strict mode (link spam safety)
 *   - (Phase 4) emoji/caps spam limits
 *
 * Strictness (setting `validation_strictness`): 'normal' (default) | 'strict'
 * Strict adds link blocking and a lower emoji ceiling. Flagged → status='flagged',
 * which never auto-sends; humans can still edit + approve (task §22).
 */

const MAX_LEN = 1500; // WhatsApp is fine with long messages, but our style target is short
const MIN_LEN = 60;

const LEAK_PATTERNS = [
  /requirements?\s*:/i,
  /style rules?\s*:/i,
  /as an ai\b/i,
  /language model/i,
  /\bgenerate a whatsapp\b/i,
  /topic\s*:\s*\$/i,
  /\[\s*(topic|audience|content type)\s*\]/i,
];

const PLACEHOLDER_PATTERNS = [/\bTODO\b/, /\bTBD\b/, /lorem ipsum/i, /\bxxx\b/];

// Phase 4: fabricated-statistic heuristic — "N%" or "N out of 10" tied to vague studies.
const FAKE_STATS_PATTERNS = [
  /\b\d{1,3}\s?%\s+of\s+(people|students|professionals|companies|employers|recruiters|developers)/i,
  /\b(studies|research|survey)s?\s+(show|say|found|prove|suggest)\b/i,
  /\b\d+\s+(out\s+of\s+10)\b/i,
  /\b9[05]\s?%\b/i, // the classic made-up "90%/95% of recruiters…"
];

// Phase 4: never invite off-platform contact.
const CONTACT_PATTERNS = [
  /\b[\w.%+-]+@[\w.-]+\.[A-Za-z]{2,}\b/, // emails
  /(\+?\d[\d\s-]{8,}\d)/, // phone-like numbers
  /\b(my|our)\s+(whatsapp|dm|inbox)\b/i,
  /\b(dm|inbox|whatsapp)\s+me\b/i,
];

const EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu;
const LINK_RE = /\b(?:https?:\/\/|www\.)\S+/i;

/**
 * @param {string} text
 * @param {{ strict?: boolean }} [opts]
 * @returns {{ ok: boolean, issues: string[] }}
 */
function validateContent(text, opts = {}) {
  const issues = [];
  const s = String(text || '').trim();
  const strict = Boolean(opts.strict);

  if (s.length === 0) issues.push('Content is empty.');
  if (s.length < MIN_LEN) issues.push(`Content too short (< ${MIN_LEN} chars).`);
  if (s.length > MAX_LEN) issues.push(`Content too long (> ${MAX_LEN} chars).`);

  for (const p of LEAK_PATTERNS) {
    if (p.test(s)) {
      issues.push(`Possible prompt/instruction leakage (matched ${p}).`);
      break;
    }
  }
  for (const p of PLACEHOLDER_PATTERNS) {
    if (p.test(s)) issues.push(`Placeholder text found (matched ${p}).`);
  }

  // ── Phase 4 rules ────────────────────────────────────────────────────────
  for (const p of FAKE_STATS_PATTERNS) {
    if (p.test(s)) {
      issues.push('Possible fabricated statistic — evergreen content must not cite unverified numbers.');
      break;
    }
  }

  for (const p of CONTACT_PATTERNS) {
    if (p.test(s)) {
      issues.push('Contains contact info / DM invitation — not allowed in automated posts.');
      break;
    }
  }

  const emojiCount = (s.match(EMOJI_RE) || []).length;
  const emojiCeiling = strict ? 6 : 10;
  if (emojiCount > emojiCeiling) {
    issues.push(`Emoji spam (${emojiCount} > ${emojiCeiling}).`);
  }

  const words = s.split(/\s+/).filter(Boolean);
  const capsRuns = words.filter((w) => w.length >= 4 && w === w.toUpperCase() && /[A-Z]/.test(w));
  if (capsRuns.length >= 5) {
    issues.push(`SHOUTING CAPS used ${capsRuns.length} times.`);
  }

  if (strict && LINK_RE.test(s)) {
    issues.push('Links are not allowed in strict mode.');
  }

  return { ok: issues.length === 0, issues };
}

module.exports = { validateContent, MIN_LEN, MAX_LEN };
