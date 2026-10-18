/**
 * Request handling for the Optimus proxy, written against plain Fetch API
 * types with its collaborators injected so it runs unchanged under Node in
 * unit tests and in the Workers runtime.
 *
 * Privacy: request and response bodies contain the user's personal data.
 * They are parsed only for validation and usage metering and are never
 * logged. Logs contain model names, token counts and costs only.
 */

import { isAuthorized } from './auth';
import { errorResponse, json } from './http';
import { isValidCap, MAX_CAP_USD, type LedgerApi } from './ledgerCore';
import { costUsd } from './pricing';
import { readUsage } from './usage';

export const ANTHROPIC_API_ORIGIN = 'https://api.anthropic.com';
export const DEFAULT_ANTHROPIC_VERSION = '2023-06-01';
export const MAX_TOKENS_LIMIT = 64_000;
export const DEFAULT_ALLOWED_MODELS = ['claude-sonnet-5-5', 'claude-haiku-5-5'];

/** Worker configuration: secrets plus the [vars] in wrangler.toml. */
export interface HandlerEnv {
  ANTHROPIC_API_KEY?: string;
  APP_TOKEN?: string;
  ALLOWED_MODELS?: string;
  DEFAULT_CAP_USD?: string;
  RATE_LIMIT_PER_MINUTE?: string;
}

export interface HandlerDeps {
  ledger: LedgerApi;
  /** Performs the upstream call; `fetch` in production, a fake in tests. */
  upstreamFetch: (request: Request) => Promise<Response>;
  /** Keeps background work (usage metering) alive after the response is returned. */
  waitUntil: (promise: Promise<unknown>) => void;
  log?: (message: string) => void;
}

type Route = 'messages' | 'count_tokens';

const UPSTREAM_PATHS: Record<Route, string> = {
  messages: '/v1/messages',
  count_tokens: '/v1/messages/count_tokens',
};

/** Response headers that describe the upstream connection, not the body we relay. */
const HOP_BY_HOP_RESPONSE_HEADERS = ['content-length', 'content-encoding', 'transfer-encoding', 'connection', 'set-cookie'];

export function allowedModels(env: HandlerEnv): string[] {
  const list = (env.ALLOWED_MODELS ?? '')
    .split(',')
    .map((m) => m.trim())
    .filter(Boolean);
  return list.length > 0 ? list : DEFAULT_ALLOWED_MODELS;
}

export async function handle(request: Request, env: HandlerEnv, deps: HandlerDeps): Promise<Response> {
  const url = new URL(request.url);
  // Tolerate a trailing slash or doubled slashes from a sloppily-entered base URL.
  const path = url.pathname.replace(/\/{2,}/g, '/').replace(/(.)\/$/, '$1');
  const method = request.method.toUpperCase();

  if (method === 'OPTIONS') return new Response(null, { status: 204 });
  if (method === 'GET' && path === '/health') return json({ ok: true });

  // Everything below requires the shared app token. Unknown paths are also
  // behind auth so the proxy reveals nothing to unauthenticated callers.
  if (!env.APP_TOKEN || !env.ANTHROPIC_API_KEY) {
    return errorResponse(500, 'optimus_misconfigured', 'Proxy is missing the APP_TOKEN or ANTHROPIC_API_KEY secret.');
  }
  if (!isAuthorized(request.headers.get('x-optimus-token'), env.APP_TOKEN)) {
    return errorResponse(401, 'optimus_unauthorized', 'Missing or invalid x-optimus-token header.');
  }

  try {
    if (method === 'POST' && path === '/v1/messages') return await forward('messages', request, url, env, deps);
    if (method === 'POST' && path === '/v1/messages/count_tokens') {
      return await forward('count_tokens', request, url, env, deps);
    }
    if (method === 'GET' && path === '/usage') return json(await ledgerCall(() => deps.ledger.usage()));
    if (method === 'PUT' && path === '/cap') return await putCap(request, deps.ledger);
  } catch (err) {
    if (err instanceof LedgerError) {
      return errorResponse(503, 'optimus_ledger_unavailable', 'Spending ledger is temporarily unavailable.');
    }
    throw err;
  }

  return errorResponse(404, 'optimus_not_found', `No route for ${method} ${path}.`);
}

/** Wraps failures talking to the Durable Object so they map to a 503. */
class LedgerError extends Error {}

async function ledgerCall<T>(op: () => Promise<T>): Promise<T> {
  try {
    return await op();
  } catch (err) {
    throw new LedgerError(err instanceof Error ? err.message : String(err));
  }
}

async function putCap(request: Request, ledger: LedgerApi): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, 'optimus_invalid_cap', 'Body must be JSON like {"capUsd": 25}.');
  }
  const capUsd = (body as { capUsd?: unknown } | null)?.capUsd;
  if (!isValidCap(capUsd)) {
    return errorResponse(400, 'optimus_invalid_cap', `capUsd must be a number greater than 0 and at most ${MAX_CAP_USD}.`);
  }
  return json(await ledgerCall(() => ledger.setCap(capUsd)));
}

async function forward(route: Route, request: Request, url: URL, env: HandlerEnv, deps: HandlerDeps): Promise<Response> {
  // --- Validate. The original text is forwarded byte-for-byte. -------------
  const bodyText = await request.text();
  let payload: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(bodyText);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new TypeError();
    payload = parsed as Record<string, unknown>;
  } catch {
    return errorResponse(400, 'optimus_invalid_request', 'Request body must be a JSON object.');
  }

  const model = payload.model;
  const allowed = allowedModels(env);
  if (typeof model !== 'string' || !allowed.includes(model)) {
    return errorResponse(400, 'optimus_model_not_allowed', `Model must be one of: ${allowed.join(', ')}.`, {
      allowedModels: allowed,
    });
  }
  if (typeof payload.max_tokens === 'number' && payload.max_tokens > MAX_TOKENS_LIMIT) {
    return errorResponse(400, 'optimus_max_tokens_too_large', `max_tokens must be at most ${MAX_TOKENS_LIMIT}.`, {
      maxTokens: MAX_TOKENS_LIMIT,
    });
  }

  // --- Admission: spending cap (billable calls only) and rate limit. -------
  const verdict = await ledgerCall(() => deps.ledger.check({ enforceCap: route === 'messages' }));
  if (!verdict.ok) {
    if (verdict.reason === 'spending_cap') {
      return errorResponse(
        402,
        'optimus_spending_cap_reached',
        `Monthly spending cap of $${verdict.capUsd.toFixed(2)} reached`,
        { spentUsd: verdict.spentUsd, capUsd: verdict.capUsd },
        // Tell the Anthropic SDK not to retry; this won't clear until next month.
        { 'x-should-retry': 'false' },
      );
    }
    return errorResponse(
      429,
      'optimus_rate_limited',
      `Too many requests; try again in ${verdict.retryAfterSeconds}s.`,
      { retryAfterSeconds: verdict.retryAfterSeconds },
      { 'retry-after': String(verdict.retryAfterSeconds) },
    );
  }

  // --- Forward. Only an explicit allowlist of headers goes upstream; the
  // app's placeholder x-api-key and its x-optimus-token are dropped. -------
  const headers = new Headers({
    'content-type': 'application/json',
    'x-api-key': env.ANTHROPIC_API_KEY!,
    'anthropic-version': request.headers.get('anthropic-version') || DEFAULT_ANTHROPIC_VERSION,
  });
  const beta = request.headers.get('anthropic-beta');
  if (beta) headers.set('anthropic-beta', beta);
  const accept = request.headers.get('accept');
  if (accept) headers.set('accept', accept);

  // Preserve the query string (the SDK's beta client sends `?beta=true`).
  const upstreamUrl = `${ANTHROPIC_API_ORIGIN}${UPSTREAM_PATHS[route]}${url.search}`;
  let upstream: Response;
  try {
    upstream = await deps.upstreamFetch(
      new Request(upstreamUrl, { method: 'POST', headers, body: bodyText, signal: request.signal }),
    );
  } catch {
    return errorResponse(502, 'optimus_upstream_unreachable', 'Could not reach the Anthropic API.');
  }

  const responseHeaders = new Headers(upstream.headers);
  for (const name of HOP_BY_HOP_RESPONSE_HEADERS) responseHeaders.delete(name);

  // --- Meter. Only successful message calls are billed. One tee branch goes
  // to the client untouched and unbuffered; the other is parsed off the
  // response path for usage. ------------------------------------------------
  let clientBody = upstream.body;
  if (route === 'messages' && upstream.ok && upstream.body) {
    const [toClient, toMeter] = upstream.body.tee();
    clientBody = toClient;
    deps.waitUntil(meter(toMeter, upstream.headers.get('content-type'), model, deps));
  }

  return new Response(clientBody, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
}

async function meter(
  body: ReadableStream<Uint8Array>,
  contentType: string | null,
  requestedModel: string,
  deps: HandlerDeps,
): Promise<void> {
  const log = deps.log ?? console.log;
  try {
    const metered = await readUsage(body, contentType);
    // Price by the model that actually served the request; the API may fall
    // back to a different model than the one requested.
    const servedModel = metered?.model ?? requestedModel;
    const usage = metered?.usage ?? {};
    const cost = costUsd(servedModel, usage);
    const totals = await deps.ledger.record(cost);
    log(
      `optimus usage model=${servedModel} in=${usage.input_tokens ?? 0} out=${usage.output_tokens ?? 0} ` +
        `cache_write=${usage.cache_creation_input_tokens ?? 0} cache_read=${usage.cache_read_input_tokens ?? 0} ` +
        `cost=$${cost.toFixed(6)} month=${totals.month} spent=$${totals.spentUsd.toFixed(4)}/$${totals.capUsd}`,
    );
  } catch (err) {
    log(`optimus metering failed: ${err instanceof Error ? err.name : 'unknown error'}`);
  }
}
