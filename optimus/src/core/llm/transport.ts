import type {
  BetaMessage,
  BetaMessageParam,
  BetaTextBlockParam,
  BetaTool,
  BetaToolChoice,
} from '@anthropic-ai/sdk/resources/beta/messages/messages';

export interface ChatRequest {
  model: string;
  system: BetaTextBlockParam[];
  messages: BetaMessageParam[];
  tools: BetaTool[];
  toolChoice?: BetaToolChoice;
  maxTokens: number;
  effort: 'low' | 'medium' | 'high';
}

/**
 * How the agent talks to the model. The app uses the Anthropic SDK (or OpenAI) through the
 * proxy (src/platform/claude.ts); tests and the offline demo use fakes.
 */
export interface LlmTransport {
  readonly label: string;
  stream(req: ChatRequest, onText: (delta: string) => void, signal?: AbortSignal): Promise<BetaMessage>;
}

/** Errors the UI turns into friendly, on-brand messages. */
export type LlmErrorKind =
  | 'offline'
  | 'not-configured'
  | 'unauthorized'
  | 'spending-cap'
  | 'rate-limited'
  | 'overloaded'
  | 'refused'
  | 'aborted'
  | 'unknown';

export class LlmError extends Error {
  constructor(
    public readonly kind: LlmErrorKind,
    message: string,
    public readonly detail?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'LlmError';
  }
}

/** Plain-language copy for each error kind. Never shows raw errors. */
export function friendlyError(e: unknown): { title: string; body: string; kind: LlmErrorKind } {
  const kind: LlmErrorKind = e instanceof LlmError ? e.kind : 'unknown';
  switch (kind) {
    case 'offline':
      return { kind, title: 'No signal', body: 'I can’t reach my reasoning core without a connection. Your conversations, memories and last brief are still here.' };
    case 'not-configured':
      return { kind, title: 'Link not set up', body: 'Add your proxy address and token in Settings › Connection to bring me online.' };
    case 'unauthorized':
      return { kind, title: 'Access key rejected', body: 'The proxy didn’t accept the app token. Check it in Settings › Connection.' };
    case 'spending-cap': {
      const cap = e instanceof LlmError ? e.detail?.capUsd : undefined;
      return { kind, title: 'Monthly limit reached', body: `You’ve hit your ${cap ? `$${cap} ` : ''}monthly spending cap. Raise it in Settings › Usage, or I’ll be back on the 1st.` };
    }
    case 'rate-limited':
      return { kind, title: 'Cooling down', body: 'Too many requests in a minute. Give me a moment and try again.' };
    case 'overloaded':
      return { kind, title: 'Servers are busy', body: 'The AI service is overloaded right now. Try again in a minute.' };
    case 'refused':
      return { kind, title: 'I can’t help with that one', body: 'That request was declined by the model’s safety checks.' };
    case 'aborted':
      return { kind, title: 'Stopped', body: 'You stopped that reply.' };
    default:
      return { kind, title: 'Something went wrong', body: 'That request didn’t go through. Try again in a moment.' };
  }
}
