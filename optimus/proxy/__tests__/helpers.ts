/** Shared fakes for proxy tests. Not a test file itself (no `.test.ts`). */

import type { KvStorage } from '../src/ledgerCore';

/** In-memory stand-in for Durable Object storage (structured-clones values like the real one). */
export class MemoryStorage implements KvStorage {
  readonly data = new Map<string, unknown>();

  async get<T>(key: string): Promise<T | undefined> {
    const value = this.data.get(key);
    return value === undefined ? undefined : (structuredClone(value) as T);
  }

  async put<T>(key: string, value: T): Promise<void> {
    this.data.set(key, structuredClone(value));
  }
}

/** A controllable clock. */
export function fakeClock(start: string | number) {
  let now = typeof start === 'number' ? start : Date.parse(start);
  return {
    now: () => now,
    set: (t: string | number) => {
      now = typeof t === 'number' ? t : Date.parse(t);
    },
    advance: (ms: number) => {
      now += ms;
    },
  };
}

/** Splits bytes into a stream of the given chunk sizes (cycled). */
export function chunkedStream(bytes: Uint8Array, sizes: number[]): ReadableStream<Uint8Array> {
  let offset = 0;
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.length) {
        controller.close();
        return;
      }
      const size = sizes[i++ % sizes.length];
      controller.enqueue(bytes.slice(offset, offset + size));
      offset += size;
    },
  });
}

export function sse(events: { event: string; data: unknown }[]): string {
  return events.map((e) => `event: ${e.event}\ndata: ${JSON.stringify(e.data)}\n\n`).join('');
}

/** A realistic streamed Messages API response. */
export function sampleStream(model: string, text = 'Hello there — ünïcødé ✓') {
  return sse([
    {
      event: 'message_start',
      data: {
        type: 'message_start',
        message: {
          id: 'msg_1',
          type: 'message',
          role: 'assistant',
          model,
          content: [],
          stop_reason: null,
          usage: {
            input_tokens: 1000,
            cache_creation_input_tokens: 2000,
            cache_read_input_tokens: 3000,
            output_tokens: 1,
          },
        },
      },
    },
    { event: 'content_block_start', data: { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } } },
    { event: 'ping', data: { type: 'ping' } },
    { event: 'content_block_delta', data: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } } },
    { event: 'content_block_stop', data: { type: 'content_block_stop', index: 0 } },
    { event: 'message_delta', data: { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 250 } } },
    { event: 'message_delta', data: { type: 'message_delta', delta: {}, usage: { output_tokens: 500 } } },
    { event: 'message_stop', data: { type: 'message_stop' } },
  ]);
}
