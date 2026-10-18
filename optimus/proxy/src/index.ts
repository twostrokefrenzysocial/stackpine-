/**
 * Optimus proxy: Cloudflare Worker entry point.
 *
 * Wires the runtime-agnostic handler (handler.ts) to the real `fetch`, the
 * execution context and the global `Ledger` Durable Object.
 */

import { connect } from 'cloudflare:sockets';
import { handle, type HandlerEnv } from './handler';
import type { Conn, OpenConn } from './mail/conn';
import { Ledger } from './ledger';

export { Ledger };

export interface Env extends HandlerEnv {
  LEDGER: DurableObjectNamespace<Ledger>;
}

/** A cloudflare:sockets TCP socket as a mail Conn. */
function wrap(socket: Socket): Conn {
  const reader = socket.readable.getReader();
  const writer = socket.writable.getWriter();
  const enc = new TextEncoder();
  return {
    async read() {
      const r = await reader.read();
      return r.done ? null : r.value;
    },
    async write(data) {
      // Mail commands are ASCII; message bodies are already base64.
      await writer.write(enc.encode(data));
    },
    async close() {
      await socket.close();
    },
    startTls() {
      reader.releaseLock();
      writer.releaseLock();
      return wrap(socket.startTls());
    },
  };
}

const openConn: OpenConn = (host, port, tls) => wrap(connect({ hostname: host, port }, { secureTransport: tls, allowHalfOpen: false }));

export default {
  async fetch(request, env, ctx): Promise<Response> {
    // One global ledger: the proxy serves a single person, so a single
    // instance gives exact, strongly-consistent spend and rate counts.
    const ledger = env.LEDGER.get(env.LEDGER.idFromName('global'));

    return handle(request, env, {
      ledger,
      upstreamFetch: (upstreamRequest) => fetch(upstreamRequest),
      waitUntil: (promise) => ctx.waitUntil(promise),
      openConn,
    });
  },
} satisfies ExportedHandler<Env>;
