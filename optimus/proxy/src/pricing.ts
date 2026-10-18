/**
 * Anthropic list prices and a pure cost calculator.
 *
 * Prices are USD per million tokens. Keep this table in sync with
 * https://www.anthropic.com/pricing when models or prices change.
 */

/** Token counts as reported by the Messages API `usage` object. */
export interface Usage {
  input_tokens?: number;
  output_tokens?: number;
  /** Total tokens written to the prompt cache (all TTLs). */
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  /** Optional per-TTL breakdown of `cache_creation_input_tokens`. */
  cache_creation?: {
    ephemeral_5m_input_tokens?: number;
    ephemeral_1h_input_tokens?: number;
  };
  /** Server-side tools that are billed per use rather than per token. */
  server_tool_use?: {
    web_search_requests?: number;
  };
}

export interface ModelPrice {
  input: number;
  output: number;
  /** 5-minute TTL cache write. */
  cacheWrite5m: number;
  /** 1-hour TTL cache write (2x base input price). */
  cacheWrite1h: number;
  cacheRead: number;
}

const SONNET: ModelPrice = {
  input: 2.0,
  output: 10.0,
  cacheWrite5m: 2.5,
  cacheWrite1h: 4.0,
  cacheRead: 0.2,
};

const HAIKU: ModelPrice = {
  input: 0.1,
  output: 0.5,
  cacheWrite5m: 0.125,
  cacheWrite1h: 0.2,
  cacheRead: 0.01,
};

/**
 * Model id prefixes, longest first so the most specific entry wins. Prefix
 * matching also covers dated snapshot ids such as `claude-haiku-5-5-20261001`.
 */
const PRICE_TABLE: readonly (readonly [prefix: string, price: ModelPrice])[] = [
  ['claude-sonnet-5-5', SONNET],
  ['claude-haiku-5-5', HAIKU],
  // Server-side fallback target for Sonnet 5.5; same price.
  ['claude-sonnet-5', SONNET],
];

/** Unknown models are priced as Sonnet so the cap errs on the safe side. */
const FALLBACK_PRICE = SONNET;

/** Web search is billed at $10 per 1,000 searches, independent of model. */
const WEB_SEARCH_USD_PER_REQUEST = 10 / 1000;

export function priceFor(model: string | undefined | null): ModelPrice {
  if (model) {
    for (const [prefix, price] of PRICE_TABLE) {
      if (model === prefix || model.startsWith(`${prefix}-`)) return price;
    }
  }
  return FALLBACK_PRICE;
}

/** Treats missing, negative and non-finite counts as zero. */
function n(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * Cost in USD of a single request.
 *
 * Cache writes are split by TTL when the API reports the breakdown; any
 * tokens not covered by the breakdown are billed at the 5-minute rate.
 */
export function costUsd(model: string | undefined | null, usage: Usage): number {
  const price = priceFor(model);

  const cacheWriteTotal = n(usage.cache_creation_input_tokens);
  const cacheWrite1h = Math.min(n(usage.cache_creation?.ephemeral_1h_input_tokens), cacheWriteTotal);
  const cacheWrite5m = cacheWriteTotal - cacheWrite1h;

  const tokenCost =
    n(usage.input_tokens) * price.input +
    n(usage.output_tokens) * price.output +
    cacheWrite5m * price.cacheWrite5m +
    cacheWrite1h * price.cacheWrite1h +
    n(usage.cache_read_input_tokens) * price.cacheRead;

  return tokenCost / 1_000_000 + n(usage.server_tool_use?.web_search_requests) * WEB_SEARCH_USD_PER_REQUEST;
}

/** OpenAI prices, USD per million tokens. Set per model in OPENAI_PRICES. */
export interface OpenAIPrice {
  input: number;
  output: number;
  cacheRead?: number;
}

/**
 * OpenAI models without a configured price are billed at this deliberately
 * high rate, so a missing entry makes the cap trip early rather than late.
 */
export const OPENAI_FALLBACK_PRICE: OpenAIPrice = { input: 15, output: 75, cacheRead: 15 };

/**
 * Built-in list prices for common OpenAI models (USD per million tokens, as
 * published by OpenAI when these models launched). OPENAI_PRICES overrides
 * any of them; check https://platform.openai.com/pricing for changes.
 */
export const DEFAULT_OPENAI_PRICES: Record<string, OpenAIPrice> = {
  'gpt-5': { input: 1.25, output: 10, cacheRead: 0.125 },
  'gpt-5-mini': { input: 0.25, output: 2, cacheRead: 0.025 },
  'gpt-5-nano': { input: 0.05, output: 0.4, cacheRead: 0.005 },
  'gpt-4.1': { input: 2, output: 8, cacheRead: 0.5 },
  'gpt-4.1-mini': { input: 0.4, output: 1.6, cacheRead: 0.1 },
  'gpt-4o-mini': { input: 0.15, output: 0.6, cacheRead: 0.075 },
};

export function parseOpenAIPrices(raw: string | undefined): Record<string, OpenAIPrice> {
  return { ...DEFAULT_OPENAI_PRICES, ...parseConfiguredPrices(raw) };
}

function parseConfiguredPrices(raw: string | undefined): Record<string, OpenAIPrice> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return {};
    const out: Record<string, OpenAIPrice> = {};
    for (const [model, v] of Object.entries(parsed as Record<string, Partial<OpenAIPrice>>)) {
      if (v && Number.isFinite(v.input) && Number.isFinite(v.output)) out[model] = { input: Number(v.input), output: Number(v.output), cacheRead: Number.isFinite(v.cacheRead) ? Number(v.cacheRead) : undefined };
    }
    return out;
  } catch {
    return {};
  }
}

/** Exact id first, then the longest configured prefix (covers dated snapshots). */
export function openAIPriceFor(model: string | undefined | null, table: Record<string, OpenAIPrice>): OpenAIPrice {
  if (model) {
    if (table[model]) return table[model];
    const prefix = Object.keys(table)
      .filter((k) => model.startsWith(`${k}-`))
      .sort((a, b) => b.length - a.length)[0];
    if (prefix) return table[prefix];
  }
  return OPENAI_FALLBACK_PRICE;
}

/** Usage here is already mapped: input_tokens excludes cached prompt tokens. */
export function openAICostUsd(model: string | undefined | null, usage: Usage, table: Record<string, OpenAIPrice>): number {
  const price = openAIPriceFor(model, table);
  const cacheRead = price.cacheRead ?? price.input;
  // OpenAI web search is billed per call (about $10 per 1,000).
  return (n(usage.input_tokens) * price.input + n(usage.output_tokens) * price.output + n(usage.cache_read_input_tokens) * cacheRead) / 1_000_000 + n(usage.server_tool_use?.web_search_requests) * WEB_SEARCH_USD_PER_REQUEST;
}
