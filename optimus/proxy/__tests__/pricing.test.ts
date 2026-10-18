import { costUsd, openAICostUsd, openAIPriceFor, parseOpenAIPrices, priceFor } from '../src/pricing';

describe('costUsd', () => {
  it('prices Sonnet 5.5 per million tokens', () => {
    expect(
      costUsd('claude-sonnet-5-5', {
        input_tokens: 1_000_000,
        output_tokens: 1_000_000,
        cache_creation_input_tokens: 1_000_000,
        cache_read_input_tokens: 1_000_000,
      }),
    ).toBeCloseTo(2 + 10 + 2.5 + 0.2, 10);
  });

  it('prices Haiku 5.5', () => {
    expect(
      costUsd('claude-haiku-5-5', {
        input_tokens: 1_000_000,
        output_tokens: 1_000_000,
        cache_creation_input_tokens: 1_000_000,
        cache_read_input_tokens: 1_000_000,
      }),
    ).toBeCloseTo(0.1 + 0.5 + 0.125 + 0.01, 10);
  });

  it('prices the claude-sonnet-5 fallback model and dated snapshots like Sonnet', () => {
    expect(priceFor('claude-sonnet-5')).toBe(priceFor('claude-sonnet-5-5'));
    expect(priceFor('claude-haiku-5-5-20261001')).toBe(priceFor('claude-haiku-5-5'));
  });

  it('prices unknown models conservatively at Sonnet rates', () => {
    expect(priceFor('claude-mystery-9')).toBe(priceFor('claude-sonnet-5-5'));
    expect(priceFor(undefined)).toBe(priceFor('claude-sonnet-5-5'));
    // A prefix match must be on a dash boundary.
    expect(priceFor('claude-haiku-5-55')).toBe(priceFor('claude-sonnet-5-5'));
  });

  it('bills 1-hour cache writes at 2x input when the breakdown is reported', () => {
    const cost = costUsd('claude-sonnet-5-5', {
      cache_creation_input_tokens: 1_000_000,
      cache_creation: { ephemeral_5m_input_tokens: 400_000, ephemeral_1h_input_tokens: 600_000 },
    });
    expect(cost).toBeCloseTo(0.4 * 2.5 + 0.6 * 4.0, 10);
  });

  it('adds web search requests at $10 per thousand', () => {
    expect(costUsd('claude-haiku-5-5', { server_tool_use: { web_search_requests: 3 } })).toBeCloseTo(0.03, 10);
  });

  it('treats missing or invalid counts as zero', () => {
    expect(costUsd('claude-sonnet-5-5', {})).toBe(0);
    expect(costUsd('claude-sonnet-5-5', { input_tokens: -5, output_tokens: NaN })).toBe(0);
  });
});

describe('OpenAI prices', () => {
  it('knows common models out of the box and lets OPENAI_PRICES override them', () => {
    const table = parseOpenAIPrices(undefined);
    expect(openAICostUsd('gpt-5-mini', { input_tokens: 1_000_000, output_tokens: 1_000_000 }, table)).toBeCloseTo(2.25, 6);
    expect(openAIPriceFor('gpt-5-mini-2025-08-07', table).input).toBe(0.25);
    expect(openAIPriceFor('gpt-5-2025-08-07', table).input).toBe(1.25);
    const custom = parseOpenAIPrices('{"gpt-5-mini":{"input":1,"output":1}}');
    expect(openAIPriceFor('gpt-5-mini', custom)).toEqual({ input: 1, output: 1, cacheRead: undefined });
  });
});
