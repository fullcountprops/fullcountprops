// frontend/lib/ai/clients.ts
// Unified AI client that routes to Anthropic, DeepSeek, or OpenAI

import {
  AIModel,
  AIResponse,
  MODEL_API_IDS,
  MODEL_COSTS,
  MODEL_PROVIDERS,
} from './types';

const MAX_RETRIES = 3;
const RETRY_DELAYS = [1000, 2000, 4000]; // ms

interface CallOptions {
  model: AIModel;
  system_prompt: string;
  user_prompt: string;
  prompt_id: string;
  temperature?: number;
  max_tokens?: number;
}

function getApiKey(provider: 'anthropic' | 'deepseek' | 'openai'): string {
  const keys: Record<string, string | undefined> = {
    anthropic: process.env.ANTHROPIC_API_KEY,
    deepseek: process.env.DEEPSEEK_API_KEY,
    openai: process.env.OPENAI_API_KEY,
  };
  const key = keys[provider];
  if (!key) throw new Error(`Missing API key for ${provider}`);
  return key;
}

async function callWithRetry(
  fn: () => Promise<Response>,
  retries = MAX_RETRIES
): Promise<Response> {
  for (let i = 0; i < retries; i++) {
    const res = await fn();
    if (res.ok) return res;
    if (res.status === 429 || res.status >= 500) {
      if (i < retries - 1) {
        await new Promise((r) => setTimeout(r, RETRY_DELAYS[i]));
        continue;
      }
    }
    const body = await res.text();
    throw new Error(`API error ${res.status}: ${body.slice(0, 200)}`);
  }
  throw new Error('Unreachable');
}

function computeCost(
  model: AIModel,
  inputTokens: number,
  outputTokens: number
): number {
  const costs = MODEL_COSTS[model];
  return (
    (inputTokens / 1_000_000) * costs.input +
    (outputTokens / 1_000_000) * costs.output
  );
}

async function callAnthropic(opts: CallOptions): Promise<AIResponse> {
  const start = Date.now();
  const res = await callWithRetry(() =>
    fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': getApiKey('anthropic'),
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL_API_IDS[opts.model],
        max_tokens: opts.max_tokens || 2048,
        system: opts.system_prompt,
        messages: [{ role: 'user', content: opts.user_prompt }],
        temperature: opts.temperature ?? 0.3,
      }),
    })
  );
  const data = await res.json();
  const inputTokens = data.usage?.input_tokens || 0;
  const outputTokens = data.usage?.output_tokens || 0;
  return {
    model: opts.model,
    prompt_id: opts.prompt_id,
    content: data.content?.[0]?.text || '',
    usage: {
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      cost_usd: computeCost(opts.model, inputTokens, outputTokens),
    },
    latency_ms: Date.now() - start,
  };
}

async function callDeepSeek(opts: CallOptions): Promise<AIResponse> {
  const start = Date.now();
  const res = await callWithRetry(() =>
    fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${getApiKey('deepseek')}`,
      },
      body: JSON.stringify({
        model: MODEL_API_IDS[opts.model],
        messages: [
          { role: 'system', content: opts.system_prompt },
          { role: 'user', content: opts.user_prompt },
        ],
        temperature: opts.temperature ?? 0.3,
        max_tokens: opts.max_tokens || 2048,
      }),
    })
  );
  const data = await res.json();
  const inputTokens = data.usage?.prompt_tokens || 0;
  const outputTokens = data.usage?.completion_tokens || 0;
  return {
    model: opts.model,
    prompt_id: opts.prompt_id,
    content: data.choices?.[0]?.message?.content || '',
    usage: {
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      cost_usd: computeCost(opts.model, inputTokens, outputTokens),
    },
    latency_ms: Date.now() - start,
  };
}

async function callOpenAI(opts: CallOptions): Promise<AIResponse> {
  const start = Date.now();
  const res = await callWithRetry(() =>
    fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${getApiKey('openai')}`,
      },
      body: JSON.stringify({
        model: MODEL_API_IDS[opts.model],
        messages: [
          { role: 'system', content: opts.system_prompt },
          { role: 'user', content: opts.user_prompt },
        ],
        temperature: opts.temperature ?? 0.3,
        max_tokens: opts.max_tokens || 2048,
      }),
    })
  );
  const data = await res.json();
  const inputTokens = data.usage?.prompt_tokens || 0;
  const outputTokens = data.usage?.completion_tokens || 0;
  return {
    model: opts.model,
    prompt_id: opts.prompt_id,
    content: data.choices?.[0]?.message?.content || '',
    usage: {
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      cost_usd: computeCost(opts.model, inputTokens, outputTokens),
    },
    latency_ms: Date.now() - start,
  };
}

/**
 * Main entry point: call the right provider based on model.
 */
export async function callAI(opts: CallOptions): Promise<AIResponse> {
  const provider = MODEL_PROVIDERS[opts.model];
  switch (provider) {
    case 'anthropic':
      return callAnthropic(opts);
    case 'deepseek':
      return callDeepSeek(opts);
    case 'openai':
      return callOpenAI(opts);
    default:
      throw new Error(`Unknown provider for model ${opts.model}`);
  }
}
