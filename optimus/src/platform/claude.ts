import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import type { BetaMessage } from '@anthropic-ai/sdk/resources/beta/messages/messages';
import { fetch as expoFetch } from 'expo/fetch';
import type { z } from 'zod';
import type { BackgroundLlm } from '../core/llm/background';
import { BACKGROUND_MODEL } from '../core/llm/prompts';
import { LlmError, type ChatRequest, type LlmTransport } from '../core/llm/transport';

/**
 * Claude via the user's proxy. The real API key lives only in the proxy;
 * the app authenticates with a per-install secret token.
 */
export function createClient(proxyUrl: string, token: string): Anthropic {
  return new Anthropic({
    baseURL: proxyUrl.replace(/\/+$/, ''),
    apiKey: 'held-by-proxy', // placeholder; the proxy swaps in the real key
    defaultHeaders: { 'x-optimus-token': token },
    // expo/fetch supports streaming response bodies on Android.
    fetch: expoFetch as unknown as typeof globalThis.fetch,
    dangerouslyAllowBrowser: true,
    maxRetries: 2,
    timeout: 120_000,
  });
}

/** Maps SDK/proxy errors to the app's friendly error kinds. */
export function toLlmError(e: unknown): LlmError {
  if (e instanceof LlmError) return e;
  if (e instanceof Anthropic.APIUserAbortError) return new LlmError('aborted', 'aborted');
  if (e instanceof Anthropic.APIConnectionError) return new LlmError('offline', e.message);
  if (e instanceof Anthropic.APIError) {
    const body = (e.error ?? {}) as { error?: { type?: string; capUsd?: number; spentUsd?: number } };
    const type = body.error?.type ?? '';
    if (e.status === 402 || type === 'optimus_spending_cap_reached') return new LlmError('spending-cap', e.message, { capUsd: body.error?.capUsd, spentUsd: body.error?.spentUsd });
    if (e.status === 401 || type === 'optimus_unauthorized' || type === 'authentication_error') return new LlmError('unauthorized', e.message);
    if (type === 'optimus_model_not_allowed') return new LlmError('model-not-allowed', e.message);
    if (e.status === 404 && /model/i.test(e.message)) return new LlmError('model-not-found', e.message);
    if (e.status === 429) return new LlmError('rate-limited', e.message);
    if (e.status === 529 || e.status === 503 || type === 'overloaded_error') return new LlmError('overloaded', e.message);
    return new LlmError('unknown', e.message, { status: e.status, type });
  }
  return new LlmError('unknown', e instanceof Error ? e.message : String(e));
}

export class ProxyTransport implements LlmTransport {
  readonly label = 'Claude';
  constructor(private readonly client: Anthropic) {}

  async stream(req: ChatRequest, onText: (delta: string) => void, signal?: AbortSignal): Promise<BetaMessage> {
    try {
      const stream = this.client.beta.messages.stream(
        {
          model: req.model,
          max_tokens: req.maxTokens,
          system: req.system,
          messages: req.messages,
          tools: req.tools,
          tool_choice: req.toolChoice,
          output_config: { effort: req.effort },
          // Retry policy declines on a fallback model instead of failing the turn.
          fallbacks: 'default',
          betas: ['server-side-fallback-2026-07-01'],
        },
        { signal },
      );
      stream.on('text', onText);
      const message = await stream.finalMessage();
      if (message.stop_reason === 'refusal' && !message.content.some((b) => b.type === 'text')) {
        throw new LlmError('refused', 'refused');
      }
      return message;
    } catch (e) {
      throw toLlmError(e);
    }
  }
}

/** Background jobs on Haiku with structured outputs. */
export class ProxyBackgroundLlm implements BackgroundLlm {
  readonly label = 'Claude Haiku';
  constructor(private readonly client: Anthropic) {}

  async json<T>(task: { name: string; system: string; prompt: string; schema: z.ZodType<T>; maxTokens?: number }): Promise<T> {
    try {
      const res = await this.client.messages.parse({
        model: BACKGROUND_MODEL,
        max_tokens: task.maxTokens ?? 4000,
        system: task.system,
        messages: [{ role: 'user', content: task.prompt }],
        output_config: { effort: 'low', format: zodOutputFormat(task.schema as never) },
      });
      if (res.parsed_output == null) throw new LlmError('unknown', `${task.name}: no structured output (${res.stop_reason})`);
      return res.parsed_output as T;
    } catch (e) {
      throw toLlmError(e);
    }
  }
}

export interface ProxyUsage {
  month: string;
  spentUsd: number;
  capUsd: number;
  requests: number;
  remainingUsd: number;
  rateLimitPerMinute: number;
}

async function proxyJson(proxyUrl: string, token: string, path: string, init?: RequestInit): Promise<ProxyUsage> {
  let res: Response;
  try {
    res = await fetch(`${proxyUrl.replace(/\/+$/, '')}${path}`, {
      ...init,
      headers: { 'content-type': 'application/json', 'x-optimus-token': token, ...(init?.headers ?? {}) },
    });
  } catch (e) {
    throw new LlmError('offline', e instanceof Error ? e.message : String(e));
  }
  if (res.status === 401) throw new LlmError('unauthorized', 'unauthorized');
  if (!res.ok) throw new LlmError('unknown', `proxy ${res.status}`);
  return (await res.json()) as ProxyUsage;
}

export const proxyApi = {
  usage: (url: string, token: string) => proxyJson(url, token, '/usage'),
  setSpent: (url: string, token: string, spentUsd: number) => proxyJson(url, token, '/usage', { method: 'PUT', body: JSON.stringify({ spentUsd }) }),
  setCap: (url: string, token: string, capUsd: number) => proxyJson(url, token, '/cap', { method: 'PUT', body: JSON.stringify({ capUsd }) }),
};
