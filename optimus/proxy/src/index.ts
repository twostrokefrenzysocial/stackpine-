/**
 * Optimus proxy: Cloudflare Worker entry point.
 *
 * Wires the runtime-agnostic handler (handler.ts) to the real `fetch`, the
 * execution context and the global `Ledger` Durable Object.
 */

import { handle, type HandlerEnv } from './handler';
import { Ledger } from './ledger';

export { Ledger };

export interface Env extends HandlerEnv {
  LEDGER: DurableObjectNamespace<Ledger>;
}

export default {
  async fetch(request, env, ctx): Promise<Response> {
    // One global ledger: the proxy serves a single person, so a single
    // instance gives exact, strongly-consistent spend and rate counts.
    const ledger = env.LEDGER.get(env.LEDGER.idFromName('global'));

    return handle(request, env, {
      ledger,
      upstreamFetch: (upstreamRequest) => fetch(upstreamRequest),
      waitUntil: (promise) => ctx.waitUntil(promise),
    });
  },
} satisfies ExportedHandler<Env>;
