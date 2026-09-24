'use strict';

/**
 * Ollama HTTP client (no SDK — plain fetch to localhost:11434).
 * Handles: version check, model listing, content generation, mock mode.
 */

const config = require('../config');
const { AppError } = require('../util');

const MOCK_MESSAGE = (topic, audience, contentType) =>
  [
    `📚 *${contentType} of the Day*`,
    '',
    `Today's focus: *${topic}*.`,
    '',
    'Here is the core idea in one line: master the fundamentals first, then practise with a small real-world example every day — that is how concepts stick. 💡',
    '',
    '🎯 *Mini challenge:* spend 10 minutes today writing a short example of this concept from memory, then verify it against your notes.',
    '',
    'Can you do it? Reply with your answer! 👇',
    '',
    '#DailyLearning #TechTips',
  ].join('\n');

function stripThinking(raw) {
  // qwen3-family models may emit <think>...</think> reasoning blocks — remove them.
  return String(raw)
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/^[ \t]*<\/think>[ \t]*\n?/i, '')
    .trim();
}

async function ollamaFetch(pathname, init = {}, timeoutMs = 10000) {
  const url = `${config.ollama.url}${pathname}`;
  let res;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    const code = err?.cause?.code || err?.code || err?.name;
    if (code === 'ECONNREFUSED' || code === 'TimeoutError' || code === 'UND_ERR_CONNECT_TIMEOUT') {
      throw new AppError(
        503,
        'OLLAMA_UNREACHABLE',
        'Ollama is not running. Start Ollama and try again.',
        { url, cause: code }
      );
    }
    throw new AppError(502, 'OLLAMA_REQUEST_FAILED', `Ollama request failed: ${err.message}`, { url });
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new AppError(
      res.status === 404 ? 404 : 502,
      'OLLAMA_ERROR',
      `Ollama returned ${res.status} for ${pathname}`,
      { body: body.slice(0, 500) }
    );
  }
  return res.json();
}

async function checkStatus() {
  try {
    const data = await ollamaFetch('/api/version', {}, 4000);
    return { ok: true, version: data.version || 'unknown' };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function listModels() {
  const data = await ollamaFetch('/api/tags', {}, 8000);
  return (data.models || []).map((m) => ({
    name: m.name,
    sizeBytes: m.size,
    parameterSize: m.details?.parameter_size || null,
    quantization: m.details?.quantization_level || null,
  }));
}

async function isModelAvailable(model) {
  const models = await listModels();
  const wanted = String(model).toLowerCase();
  return models.some((m) => m.name.toLowerCase() === wanted || m.name.toLowerCase().startsWith(`${wanted}:`));
}

/**
 * Generate content. Returns { content, model, evalCount, durationMs }.
 * opts: { prompt, system?, model?, temperature?, maxTokens? }
 */
async function generate(opts) {
  const model = opts.model || config.ollama.model;

  if (config.mockLlm) {
    const { topic, contentType } = opts.meta || {};
    // eslint-disable-next-line no-console
    await new Promise((r) => setTimeout(r, 300)); // simulate latency
    return {
      content: MOCK_MESSAGE(topic || 'Learning', opts.meta?.audience || 'Students', contentType || 'Tip'),
      model: 'mock',
      evalCount: null,
      durationMs: 300,
      mock: true,
    };
  }

  const body = {
    model,
    prompt: opts.prompt,
    stream: false,
    // qwen3-family models emit hidden <think> reasoning before the answer —
    // measured ~2× faster with it off (72s → 36s for a WhatsApp post on CPU).
    think: false,
    keep_alive: config.ollama.keepAlive,
    options: {
      temperature: opts.temperature ?? config.ollama.temperature,
      num_predict: opts.maxTokens ?? config.ollama.maxTokens,
      num_ctx: 4096, // room for system+prompt without silent context truncation
    },
    ...(opts.system ? { system: opts.system } : {}),
  };

  const started = Date.now();
  const data = await ollamaFetch('/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, config.ollama.timeoutMs);

  const content = stripThinking(data.response || '');
  if (!content) {
    throw new AppError(502, 'EMPTY_GENERATION', 'Ollama returned an empty response.');
  }

  return {
    content,
    model: data.model || model,
    evalCount: data.eval_count ?? null,
    durationMs: Date.now() - started,
  };
}

module.exports = { checkStatus, listModels, isModelAvailable, generate, stripThinking };
