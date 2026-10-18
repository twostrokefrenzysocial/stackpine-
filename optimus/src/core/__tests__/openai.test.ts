import { z } from 'zod';
import { ChatStreamAccumulator, OpenAIBackgroundLlm, OpenAITransport, toOpenAIMessages, toOpenAIToolChoice, type OpenAIConfig } from '../llm/openai';
import type { ChatRequest } from '../llm/transport';

function sseResponse(chunks: unknown[]): Response {
  const text = chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join('') + 'data: [DONE]\n\n';
  return new Response(text, { headers: { 'content-type': 'text/event-stream' } });
}

const baseReq: ChatRequest = {
  model: 'claude-sonnet-5-5',
  system: [
    { type: 'text', text: 'STATIC' },
    { type: 'text', text: 'MEMORY' },
  ],
  messages: [{ role: 'user', content: 'When is lunch?' }],
  tools: [{ name: 'get_calendar_events', description: 'Calendar', input_schema: { type: 'object', properties: { since: { type: 'string' } } } }],
  maxTokens: 2000,
  effort: 'low',
};

function cfg(fetch: OpenAIConfig['fetch']): OpenAIConfig {
  return { baseUrl: 'https://proxy.example/', token: 'tok', model: 'oa-main', backgroundModel: 'oa-mini', fetch };
}

describe('OpenAI message conversion', () => {
  it('maps tool use, tool results and images, and drops thinking', () => {
    const out = toOpenAIMessages('SYS', [
      { role: 'user', content: 'Find the beach photo' },
      {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'hmm', signature: 'x' },
          { type: 'text', text: 'Looking.' },
          { type: 'tool_use', id: 'tu_1', name: 'look_at_photos', input: { ids: ['p1'] } },
        ],
      },
      {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'tu_1',
            content: [
              { type: 'text', text: '<untrusted_data>1 photo</untrusted_data>' },
              { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'AAAA' } },
            ],
          },
        ],
      },
    ]);
    expect(out[0]).toEqual({ role: 'system', content: 'SYS' });
    expect(out[2]).toEqual({ role: 'assistant', content: 'Looking.', tool_calls: [{ id: 'tu_1', type: 'function', function: { name: 'look_at_photos', arguments: '{"ids":["p1"]}' } }] });
    expect(out[3]).toEqual({ role: 'tool', tool_call_id: 'tu_1', content: '<untrusted_data>1 photo</untrusted_data>' });
    expect(out[4].role).toBe('user');
    expect(JSON.stringify(out[4])).toContain('data:image/jpeg;base64,AAAA');
  });

  it('marks tool errors and maps tool_choice', () => {
    const out = toOpenAIMessages('S', [{ role: 'user', content: [{ type: 'tool_result', tool_use_id: 't', is_error: true, content: 'No access' }] }]);
    expect(out[1]).toEqual({ role: 'tool', tool_call_id: 't', content: 'ERROR: No access' });
    expect(toOpenAIToolChoice({ type: 'none' })).toBe('none');
    expect(toOpenAIToolChoice({ type: 'auto' })).toBeUndefined();
    expect(toOpenAIToolChoice({ type: 'tool', name: 'x' })).toEqual({ type: 'function', function: { name: 'x' } });
  });
});

describe('ChatStreamAccumulator', () => {
  it('handles split chunks and multi-part tool arguments', () => {
    const texts: string[] = [];
    const acc = new ChatStreamAccumulator((t) => texts.push(t));
    const raw = [
      { model: 'oa-main', choices: [{ delta: { content: 'One ' } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_a', function: { name: 'search_texts', arguments: '{"que' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'ry":"Jen"}' } }] }, finish_reason: 'tool_calls' }] },
      { choices: [], usage: { prompt_tokens: 100, completion_tokens: 20, prompt_tokens_details: { cached_tokens: 60 } } },
    ]
      .map((c) => `data: ${JSON.stringify(c)}\n\n`)
      .join('');
    // Feed in awkward slices.
    for (let i = 0; i < raw.length; i += 7) acc.feed(raw.slice(i, i + 7));
    acc.end();
    const m = acc.message('oa-main');
    expect(texts.join('')).toBe('One ');
    expect(m.stop_reason).toBe('tool_use');
    expect(m.content[1]).toEqual({ type: 'tool_use', id: 'call_a', name: 'search_texts', input: { query: 'Jen' } });
    expect(m.usage.input_tokens).toBe(40);
    expect(m.usage.cache_read_input_tokens).toBe(60);
  });
});

describe('OpenAITransport', () => {
  it('posts to the proxy OpenAI route with the token and streams text', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const t = new OpenAITransport(
      cfg(async (url, init) => {
        calls.push({ url: String(url), init: init! });
        return sseResponse([{ model: 'oa-main', choices: [{ delta: { content: 'Lunch is at noon.' }, finish_reason: 'stop' }] }]);
      }),
    );
    let streamed = '';
    const m = await t.stream(baseReq, (d) => (streamed += d));
    expect(calls[0].url).toBe('https://proxy.example/openai/v1/chat/completions');
    expect((calls[0].init.headers as Record<string, string>)['x-optimus-token']).toBe('tok');
    const body = JSON.parse(String(calls[0].init.body));
    expect(body.model).toBe('oa-main');
    expect(body.messages[0]).toEqual({ role: 'system', content: 'STATIC\n\nMEMORY' });
    expect(body.tools[0].function.name).toBe('get_calendar_events');
    expect(body.reasoning_effort).toBe('low');
    expect(streamed).toBe('Lunch is at noon.');
    expect(m.stop_reason).toBe('end_turn');
  });

  it('retries without reasoning_effort for models that reject it', async () => {
    const bodies: Record<string, unknown>[] = [];
    const t = new OpenAITransport(
      cfg(async (_url, init) => {
        const b = JSON.parse(String(init!.body));
        bodies.push(b);
        if ('reasoning_effort' in b) return new Response(JSON.stringify({ error: { message: "Unsupported parameter: 'reasoning_effort'" } }), { status: 400 });
        return sseResponse([{ choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }] }]);
      }),
    );
    await t.stream(baseReq, () => {});
    expect(bodies).toHaveLength(2);
    expect('reasoning_effort' in bodies[1]).toBe(false);
  });

  it('maps proxy errors to friendly kinds', async () => {
    const t = new OpenAITransport(cfg(async () => new Response(JSON.stringify({ error: { type: 'optimus_spending_cap_reached', message: 'cap', capUsd: 20 } }), { status: 402 })));
    await expect(t.stream(baseReq, () => {})).rejects.toMatchObject({ kind: 'spending-cap' });
    const off = new OpenAITransport(
      cfg(async () => {
        throw new TypeError('Network request failed');
      }),
    );
    await expect(off.stream(baseReq, () => {})).rejects.toMatchObject({ kind: 'offline' });
    const unset = new OpenAITransport({ ...cfg(fetch), model: '' });
    await expect(unset.stream(baseReq, () => {})).rejects.toMatchObject({ kind: 'not-configured' });
  });
});

describe('OpenAIBackgroundLlm', () => {
  it('requests a JSON schema and validates the reply', async () => {
    let sent: Record<string, unknown> = {};
    const llm = new OpenAIBackgroundLlm(
      cfg(async (_u, init) => {
        sent = JSON.parse(String(init!.body));
        return new Response(JSON.stringify({ choices: [{ message: { content: '{"headline":"Busy day","narrative":"Three meetings."}' } }] }));
      }),
      (s) => z.toJSONSchema(s) as Record<string, unknown>,
    );
    const r = await llm.json({ name: 'daily_brief', system: 's', prompt: 'p', schema: z.object({ headline: z.string(), narrative: z.string() }) });
    expect(r.headline).toBe('Busy day');
    expect(sent.model).toBe('oa-mini');
    expect((sent.response_format as { type: string }).type).toBe('json_schema');
  });
});
