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
