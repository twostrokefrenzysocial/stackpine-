import { OpenAIResponsesTransport, toResponsesInput, toResponsesTools } from '../llm/openaiResponses';
import type { ChatRequest } from '../llm/transport';
import { WEB_SEARCH_TOOL } from '../tools';

const sse = (events: unknown[]) => new Response(events.map((e) => `event: x\ndata: ${JSON.stringify(e)}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } });

const req: ChatRequest = {
  model: 'x',
  system: [{ type: 'text', text: 'SYS' }],
  messages: [{ role: 'user', content: 'Weather in Cleveland and text Jen' }],
  tools: [{ name: 'propose_send_text', description: 'd', input_schema: { type: 'object', properties: {} } }, WEB_SEARCH_TOOL],
  maxTokens: 4000,
  effort: 'medium',
};

describe('OpenAI Responses transport', () => {
  it('maps tools, including web search, and sends stateless reasoning', async () => {
    const bodies: Record<string, unknown>[] = [];
    const t = new OpenAIResponsesTransport({
      baseUrl: 'https://p.example',
      token: 't',
      model: 'gpt-5',
      fetch: async (url, init) => {
        expect(String(url)).toBe('https://p.example/openai/v1/responses');
        bodies.push(JSON.parse(String(init!.body)));
        return sse([
          { type: 'response.output_text.delta', delta: 'It is 54°F ' },
          { type: 'response.output_text.delta', delta: 'and cloudy.' },
          {
            type: 'response.completed',
            response: {
              status: 'completed',
              model: 'gpt-5',
              usage: { input_tokens: 100, output_tokens: 20, input_tokens_details: { cached_tokens: 40 } },
              output: [
                { type: 'reasoning', id: 'rs_1', encrypted_content: 'ENC', summary: [] },
                { type: 'web_search_call', id: 'ws_1', status: 'completed' },
                { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'It is 54°F and cloudy.', annotations: [{ type: 'url_citation', url: 'https://weather.example/cle', title: 'Cleveland weather' }] }] },
                { type: 'function_call', call_id: 'call_1', name: 'propose_send_text', arguments: '{"to":"Jen"}' },
              ],
            },
          },
        ]);
      },
    });
    let text = '';
    const m = await t.stream(req, (d) => (text += d));
    const b = bodies[0];
    expect(b.store).toBe(false);
    expect(b.include).toEqual(['reasoning.encrypted_content']);
    expect(b.reasoning).toEqual({ effort: 'medium' });
    expect(b.instructions).toBe('SYS');
    expect(b.tools).toEqual([{ type: 'function', name: 'propose_send_text', description: 'd', parameters: { type: 'object', properties: {} }, strict: false }, { type: 'web_search' }]);
    expect(text).toBe('It is 54°F and cloudy.');
    expect(m.stop_reason).toBe('tool_use');
    expect(m.content.find((c) => c.type === 'tool_use')).toMatchObject({ id: 'call_1', name: 'propose_send_text', input: { to: 'Jen' } });
    const textBlock = m.content.find((c) => c.type === 'text') as unknown as { citations: { url: string }[] };
    expect(textBlock.citations[0].url).toBe('https://weather.example/cle');
    expect(m.usage.cache_read_input_tokens).toBe(40);

    // Next request in the same turn replays the reasoning and calls verbatim, then the tool output.
    const input = toResponsesInput([
      ...req.messages,
      { role: 'assistant', content: m.content as never },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call_1', content: 'Card shown' }] },
    ]);
    expect(input.map((i) => i.type ?? i.role)).toEqual(['user', 'reasoning', 'web_search_call', 'message', 'function_call', 'function_call_output']);
    expect(input[1]).toMatchObject({ encrypted_content: 'ENC' });
    expect(input[5]).toEqual({ type: 'function_call_output', call_id: 'call_1', output: 'Card shown' });
  });

  it('turns earlier plain turns into simple messages and keeps tools without web search when off', () => {
    expect(toResponsesInput([{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'hello' }])).toEqual([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
    ]);
    expect(toResponsesTools([req.tools[0]])).toHaveLength(1);
  });

  it('retries without reasoning options for models that do not reason', async () => {
    const bodies: Record<string, unknown>[] = [];
    const t = new OpenAIResponsesTransport({
      baseUrl: 'https://p.example',
      token: 't',
      model: 'gpt-4.1',
      fetch: async (_u, init) => {
        const b = JSON.parse(String(init!.body));
        bodies.push(b);
        if (b.reasoning) return new Response(JSON.stringify({ error: { message: "Unsupported parameter: 'reasoning.effort'" } }), { status: 400 });
        return sse([{ type: 'response.completed', response: { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'ok' }] }], usage: { input_tokens: 1, output_tokens: 1 } } }]);
      },
    });
    const m = await t.stream(req, () => {});
    expect(bodies).toHaveLength(2);
    expect(bodies[1].include).toBeUndefined();
    expect(m.stop_reason).toBe('end_turn');
  });
});
