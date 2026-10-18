import { parseJsonUsage, readUsage, SseUsageParser } from '../src/usage';
import { chunkedStream, sampleStream, sse } from './helpers';

const encoder = new TextEncoder();

const expectedUsage = {
  input_tokens: 1000,
  cache_creation_input_tokens: 2000,
  cache_read_input_tokens: 3000,
  output_tokens: 500,
};

describe('SseUsageParser', () => {
  it('extracts model and final usage from a whole stream', () => {
    const parser = new SseUsageParser();
    parser.feed(sampleStream('claude-sonnet-5-5'));
    parser.end();
    expect(parser.result()).toEqual({ model: 'claude-sonnet-5-5', usage: expectedUsage });
  });

  it('gives the same result for every possible single split point', () => {
    const text = sampleStream('claude-haiku-5-5');
    for (let i = 0; i <= text.length; i++) {
      const parser = new SseUsageParser();
      parser.feed(text.slice(0, i));
      parser.feed(text.slice(i));
      parser.end();
      expect(parser.result()).toEqual({ model: 'claude-haiku-5-5', usage: expectedUsage });
    }
  });

  it('handles one-character chunks and CRLF line endings split across chunks', () => {
    const text = sampleStream('claude-sonnet-5-5').replace(/\n/g, '\r\n');
    const parser = new SseUsageParser();
    for (const ch of text) parser.feed(ch);
    parser.end();
    expect(parser.result()).toEqual({ model: 'claude-sonnet-5-5', usage: expectedUsage });
  });

  it('takes the max of input/cache fields that message_delta also reports', () => {
    const parser = new SseUsageParser();
    parser.feed(
      sse([
        {
          event: 'message_start',
          data: { type: 'message_start', message: { model: 'claude-sonnet-5', usage: { input_tokens: 10, output_tokens: 1 } } },
        },
        {
          event: 'message_delta',
          data: {
            type: 'message_delta',
            usage: { input_tokens: 15, cache_read_input_tokens: 7, output_tokens: 40, server_tool_use: { web_search_requests: 2 } },
          },
        },
      ]),
    );
    parser.end();
    expect(parser.result()).toEqual({
      model: 'claude-sonnet-5',
      usage: { input_tokens: 15, cache_read_input_tokens: 7, output_tokens: 40, server_tool_use: { web_search_requests: 2 } },
    });
  });

  it('flushes a final event that lacks a trailing blank line', () => {
    const parser = new SseUsageParser();
    parser.feed('data: {"type":"message_delta","usage":{"output_tokens":9}}');
    parser.end();
    expect(parser.result()?.usage.output_tokens).toBe(9);
  });

  it('ignores comments, non-JSON data and unrelated events', () => {
    const parser = new SseUsageParser();
    parser.feed(': keep-alive\n\ndata: not json\n\nevent: ping\ndata: {"type":"ping"}\n\n');
    parser.end();
    expect(parser.result()).toBeNull();
  });
});

describe('readUsage', () => {
  it('decodes a byte stream split mid-UTF-8 sequence', async () => {
    const bytes = encoder.encode(sampleStream('claude-sonnet-5-5', '✓✓✓ ünïcødé'));
    const result = await readUsage(chunkedStream(bytes, [1, 2, 3, 5, 7]), 'text/event-stream; charset=utf-8');
    expect(result).toEqual({ model: 'claude-sonnet-5-5', usage: expectedUsage });
  });

  it('parses a non-streaming JSON body', async () => {
    const body = JSON.stringify({
      id: 'msg_1',
      type: 'message',
      model: 'claude-haiku-5-5',
      content: [{ type: 'text', text: 'hi' }],
      usage: { input_tokens: 12, output_tokens: 34, cache_read_input_tokens: 0 },
    });
    const result = await readUsage(chunkedStream(encoder.encode(body), [4]), 'application/json');
    expect(result).toEqual({
      model: 'claude-haiku-5-5',
      usage: { input_tokens: 12, output_tokens: 34, cache_read_input_tokens: 0 },
    });
  });

  it('returns usage seen before a stream error', async () => {
    const head = encoder.encode(sampleStream('claude-sonnet-5-5').split('event: content_block_start')[0]);
    let sent = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (!sent) {
          sent = true;
          controller.enqueue(head);
        } else {
          controller.error(new Error('connection reset'));
        }
      },
    });
    const result = await readUsage(stream, 'text/event-stream');
    expect(result?.usage.input_tokens).toBe(1000);
  });
});

describe('parseJsonUsage', () => {
  it('returns null for bodies without usage', () => {
    expect(parseJsonUsage('{"type":"error"}')).toBeNull();
    expect(parseJsonUsage('nope')).toBeNull();
  });
});
