/**
 * Response helpers. Every error the proxy itself produces uses the same shape
 * as Anthropic API errors, with an `optimus_`-prefixed type so the app can
 * tell proxy decisions apart from upstream errors:
 *
 *   { "type": "error", "error": { "type": "optimus_…", "message": "…", …extra } }
 */

export type OptimusErrorType =
  | 'optimus_unauthorized'
  | 'optimus_not_found'
  | 'optimus_invalid_request'
  | 'optimus_model_not_allowed'
  | 'optimus_max_tokens_too_large'
  | 'optimus_invalid_cap'
  | 'optimus_invalid_spent'
  | 'optimus_spending_cap_reached'
  | 'optimus_rate_limited'
  | 'optimus_misconfigured'
  | 'optimus_ledger_unavailable'
  | 'optimus_upstream_unreachable';

export function json(body: unknown, status = 200, headers?: HeadersInit): Response {
  const h = new Headers(headers);
  h.set('content-type', 'application/json; charset=utf-8');
  h.set('cache-control', 'no-store');
  return new Response(JSON.stringify(body), { status, headers: h });
}

export function errorResponse(
  status: number,
  type: OptimusErrorType,
  message: string,
  extra: Record<string, unknown> = {},
  headers?: HeadersInit,
): Response {
  return json({ type: 'error', error: { type, message, ...extra } }, status, headers);
}
