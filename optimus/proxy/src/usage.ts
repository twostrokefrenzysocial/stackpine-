/**
 * Extracts the billed model and token usage from a Messages API response,
 * either a streamed SSE body or a plain JSON body.
 *
 * Everything here is pure (no Workers APIs) so it can be unit-tested in Node.
 * Response content is parsed only to find `usage` / `model`; it is never
 * logged or retained.
 */

import type { Usage } from './pricing';

export interface MeteredResponse {
  /** Model that actually served the request (may differ from the requested one). */
  model: string | undefined;
  usage: Usage;
}

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function maxOf(a: number | undefined, b: unknown): number | undefined {
  if (typeof b !== 'number' || !Number.isFinite(b)) return a;
  return a === undefined ? b : Math.max(a, b);
}

/**
 * Merges a `usage` object into an accumulator, keeping the max of each field.
 *
 * In a stream, `message_start` carries the initial usage and every
 * `message_delta` carries cumulative counts, so max() yields the final total
 * regardless of which events repeat which fields.
 */
export function mergeUsage(into: Usage, raw: unknown): Usage {
  if (!isObject(raw)) return into;

  into.input_tokens = maxOf(into.input_tokens, raw.input_tokens);
  into.output_tokens = maxOf(into.output_tokens, raw.output_tokens);
  into.cache_creation_input_tokens = maxOf(into.cache_creation_input_tokens, raw.cache_creation_input_tokens);
  into.cache_read_input_tokens = maxOf(into.cache_read_input_tokens, raw.cache_read_input_tokens);

  if (isObject(raw.cache_creation)) {
    const cc = (into.cache_creation ??= {});
    cc.ephemeral_5m_input_tokens = maxOf(cc.ephemeral_5m_input_tokens, raw.cache_creation.ephemeral_5m_input_tokens);
    cc.ephemeral_1h_input_tokens = maxOf(cc.ephemeral_1h_input_tokens, raw.cache_creation.ephemeral_1h_input_tokens);
  }
  if (isObject(raw.server_tool_use)) {
    const st = (into.server_tool_use ??= {});
    st.web_search_requests = maxOf(st.web_search_requests, raw.server_tool_use.web_search_requests);
  }
  return into;
}

/** OpenAI usage ({prompt_tokens, completion_tokens, cached}) → the Anthropic shape. */
export function fromOpenAIUsage(raw: unknown): Usage | null {
  if (!isObject(raw) || typeof raw.prompt_tokens !== 'number') return null;
  const details = isObject(raw.prompt_tokens_details) ? raw.prompt_tokens_details : {};
  const cached = typeof details.cached_tokens === 'number' ? details.cached_tokens : 0;
  return {
    input_tokens: Math.max(0, raw.prompt_tokens - cached),
    output_tokens: typeof raw.completion_tokens === 'number' ? raw.completion_tokens : 0,
    cache_read_input_tokens: cached,
  };
}

/** OpenAI Responses usage ({input_tokens, output_tokens, cached}) plus web searches run. */
export function fromResponsesUsage(raw: unknown, output: unknown): Usage | null {
  if (!isObject(raw) || typeof raw.input_tokens !== 'number') return null;
  const details = isObject(raw.input_tokens_details) ? raw.input_tokens_details : {};
  const cached = typeof details.cached_tokens === 'number' ? details.cached_tokens : 0;
  const searches = Array.isArray(output) ? output.filter((i) => isObject(i) && i.type === 'web_search_call').length : 0;
  return {
    input_tokens: Math.max(0, raw.input_tokens - cached),
    output_tokens: typeof raw.output_tokens === 'number' ? raw.output_tokens : 0,
    cache_read_input_tokens: cached,
    ...(searches ? { server_tool_use: { web_search_requests: searches } } : {}),
  };
}

/**
 * Incremental Server-Sent Events parser that tracks Messages API usage.
 *
 * Feed it decoded text in arbitrary chunks; events, lines and even CRLF pairs
 * may be split across chunk boundaries. Implements the subset of the SSE
 * framing rules (https://html.spec.whatwg.org/#event-stream-interpretation)
 * needed here: `data:` lines are joined with "\n" and dispatched on a blank
 * line; `event:`, `id:`, `retry:` and comments are ignored because the JSON
 * payload carries its own `type`.
 */
export class SseUsageParser {
  private buffer = '';
  private dataLines: string[] = [];
  private model: string | undefined;
  private usage: Usage = {};
  private sawUsage = false;

  feed(chunk: string): void {
    let text = this.buffer + chunk;

    // A trailing "\r" might be the first half of a "\r\n" pair; hold it back.
    let held = '';
    if (text.endsWith('\r')) {
      held = '\r';
      text = text.slice(0, -1);
    }

    const lines = text.replace(/\r\n?/g, '\n').split('\n');
    // The last element is an incomplete line (possibly empty); keep it.
    this.buffer = lines.pop()! + held;
    for (const line of lines) this.processLine(line);
  }

  /** Flushes any final event not terminated by a blank line. */
  end(): void {
    if (this.buffer) {
      const rest = this.buffer.replace(/\r$/, '');
      this.buffer = '';
      if (rest) this.processLine(rest);
    }
    this.dispatch();
  }

  /** Usage seen so far, or null if no usage-bearing event has arrived. */
  result(): MeteredResponse | null {
    return this.sawUsage ? { model: this.model, usage: this.usage } : null;
  }

  private processLine(line: string): void {
    if (line === '') {
      this.dispatch();
      return;
    }
    if (line.startsWith('data:')) {
      // Per spec, strip exactly one optional space after the colon.
      this.dataLines.push(line.slice(line.startsWith('data: ') ? 6 : 5));
    }
  }

  private dispatch(): void {
    if (this.dataLines.length === 0) return;
    const data = this.dataLines.join('\n');
    this.dataLines = [];

    let event: unknown;
    try {
      event = JSON.parse(data);
    } catch {
      return; // Not JSON (e.g. a keep-alive); nothing to meter.
    }
    if (!isObject(event)) return;

    if (event.type === 'message_start' && isObject(event.message)) {
      if (typeof event.message.model === 'string') this.model = event.message.model;
      if (isObject(event.message.usage)) {
        mergeUsage(this.usage, event.message.usage);
        this.sawUsage = true;
      }
    } else if (event.type === 'message_delta' && isObject(event.usage)) {
      mergeUsage(this.usage, event.usage);
      this.sawUsage = true;
    } else if ((event.type === 'response.completed' || event.type === 'response.incomplete') && isObject(event.response)) {
      // OpenAI Responses API: the final event carries the model, usage and output.
      if (typeof event.response.model === 'string') this.model = event.response.model;
      const oa = fromResponsesUsage(event.response.usage, event.response.output);
      if (oa) {
        mergeUsage(this.usage, oa);
        this.sawUsage = true;
      }
    } else if (event.object === 'chat.completion.chunk') {
      // OpenAI: the model is on every chunk; usage arrives in the final one.
      if (typeof event.model === 'string') this.model = event.model;
      const oa = fromOpenAIUsage(event.usage);
      if (oa) {
        mergeUsage(this.usage, oa);
        this.sawUsage = true;
      }
    }
  }
}

/** Extracts usage from a non-streaming Messages API JSON body. */
export function parseJsonUsage(text: string): MeteredResponse | null {
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isObject(body) || !isObject(body.usage)) return null;
  const oa = fromOpenAIUsage(body.usage);
  if (oa) return { model: typeof body.model === 'string' ? body.model : undefined, usage: oa };
  return {
    model: typeof body.model === 'string' ? body.model : undefined,
    usage: mergeUsage({}, body.usage),
  };
}

export function isEventStream(contentType: string | null): boolean {
  return (contentType ?? '').toLowerCase().includes('text/event-stream');
}

/**
 * Consumes a response body and returns its usage.
 *
 * If the stream errors part-way (e.g. the upstream connection drops), the
 * usage observed up to that point is returned so that partial generations
 * are still counted against the cap.
 */
export async function readUsage(
  body: ReadableStream<Uint8Array>,
  contentType: string | null,
): Promise<MeteredResponse | null> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const sse = isEventStream(contentType) ? new SseUsageParser() : null;
  let jsonText = '';

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const text = decoder.decode(value, { stream: true });
      if (sse) sse.feed(text);
      else jsonText += text;
    }
    const tail = decoder.decode();
    if (sse) sse.feed(tail);
    else jsonText += tail;
  } catch {
    // Fall through with whatever was read.
  } finally {
    reader.releaseLock();
  }

  if (sse) {
    sse.end();
    return sse.result();
  }
  return parseJsonUsage(jsonText);
}
