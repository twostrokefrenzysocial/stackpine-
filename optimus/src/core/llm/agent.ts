import type {
  BetaContentBlockParam,
  BetaMessage,
  BetaMessageParam,
  BetaTextBlockParam,
  BetaToolResultBlockParam,
  BetaToolUseBlock,
} from '@anthropic-ai/sdk/resources/beta/messages/messages';
import type { ActionStore } from '../actions/actions';
import { buildMemoryContext } from '../memory/retrieval';
import { apiTools, toolByName, ALL_TOOLS } from '../tools';
import type { ToolContext, ToolDef } from '../tools/types';
import type { ChatCard, ChatMessage } from '../types';
import { describeNow } from '../util/time';
import { MAIN_MODEL, MAX_TOOL_CALLS_PER_REQUEST, OPTIMUS_SYSTEM_PROMPT } from './prompts';
import { buildSituation } from './situation';
import { LlmError, type LlmTransport } from './transport';

export type TurnEvent =
  | { type: 'text'; delta: string }
  | { type: 'tool-start'; name: string; label: string }
  | { type: 'tool-done'; name: string; summary: string; isError: boolean }
  | { type: 'cards'; cards: ChatCard[] }
  | { type: 'thinking' };

export interface TurnInput {
  userText: string;
  history: ChatMessage[];
  rollingSummary?: string;
  transport: LlmTransport;
  ctx: ToolContext;
  actions: ActionStore;
  /** Data sources the user hasn't granted, so Optimus can say what it can't see. */
  unavailableSources: string[];
  onEvent: (e: TurnEvent) => void;
  signal?: AbortSignal;
  tools?: ToolDef[];
  /** The user is talking in voice mode and will hear the reply, not read it. */
  voice?: boolean;
}

export interface TurnResult {
  text: string;
  cards: ChatCard[];
  toolCalls: number;
  apiContent: unknown[];
  stopReason: string | null;
  usedMemoryIds: string[];
}

const TOOL_LABELS: Record<string, string> = {
  search_memory: 'Searching memory',
  save_memory: 'Saving to memory',
  suggest_memory_from_data: 'Preparing a memory suggestion',
  update_memory: 'Updating memory',
  forget_memory: 'Preparing to forget',
  search_past_conversations: 'Searching past conversations',
  lookup_contact: 'Checking contacts',
  get_calendar_events: 'Reading your calendar',
  propose_create_event: 'Drafting an event',
  propose_edit_event: 'Drafting a change',
  propose_delete_event: 'Preparing deletion',
  search_texts: 'Searching texts',
  recent_text_threads: 'Scanning conversations',
  propose_send_text: 'Drafting a text',
  get_call_log: 'Reading call log',
  propose_call: 'Preparing a call',
  get_notifications: 'Reading notifications',
  catch_up: 'Sweeping everything you missed',
  search_email: 'Searching email',
  read_email: 'Reading email',
  propose_send_email: 'Drafting an email',
  find_photos: 'Searching photos',
  look_at_photos: 'Looking at photos',
  get_location: 'Checking location',
  propose_reminder: 'Drafting a reminder',
  list_reminders: 'Checking reminders',
};

export function toolLabel(name: string): string {
  return TOOL_LABELS[name] ?? 'Working';
}

const STATUS_WORDS: Record<string, string> = {
  pending: 'waiting for approval',
  approved: 'running',
  executed: 'approved and done',
  failed: 'approved but FAILED',
  cancelled: 'cancelled by the user',
};

/** Prior turns as plain text (no thinking blocks), so history edits never invalidate anything. */
export async function buildHistory(history: ChatMessage[], actions: ActionStore): Promise<BetaMessageParam[]> {
  const out: BetaMessageParam[] = [];
  for (const m of history) {
    let text = m.text.trim();
    if (m.role === 'assistant') {
      const notes: string[] = [];
      for (const c of m.cards) {
        if (c.type === 'confirm') {
          const a = await actions.get(c.actionId);
          if (a) notes.push(`[Card “${a.title}”: ${STATUS_WORDS[a.status]}${a.resultMessage ? ` — ${a.resultMessage}` : ''}]`);
        }
      }
      if (notes.length) text = `${text}\n${notes.join('\n')}`.trim();
    }
    if (!text) continue;
    const last = out[out.length - 1];
    if (last && last.role === m.role && typeof last.content === 'string') {
      last.content = `${last.content}\n\n${text}`;
    } else {
      out.push({ role: m.role, content: text });
    }
  }
  // The API requires the first message to be from the user.
  while (out.length && out[0].role !== 'user') out.shift();
  return out;
}

export function buildSystem(parts: {
  coreMemory: string;
  relevantMemory: string;
  now: Date;
  dataMode: string;
  unavailable: string[];
  rollingSummary?: string;
  situation?: string;
  voice?: boolean;
}): BetaTextBlockParam[] {
  const blocks: BetaTextBlockParam[] = [{ type: 'text', text: OPTIMUS_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }];
  if (parts.coreMemory) {
    blocks.push({ type: 'text', text: `# Who the user is\n${parts.coreMemory}`, cache_control: { type: 'ephemeral' } });
  }
  const dynamic = [
    `# Right now\n${describeNow(parts.now)}. ${parts.dataMode === 'mock' ? 'Data mode: MOCK (demo data, not the user’s real phone). Behave exactly as you would with real data.' : 'Data mode: real device data.'}`,
    parts.unavailable.length ? `Optimus cannot currently see: ${parts.unavailable.join(', ')}. If a question needs them, say so.` : '',
    parts.situation ?? '',
    parts.voice
      ? '# Voice mode\nThe user is talking to you hands-free and will hear your reply read aloud. Answer like a person on a call: one to three short, natural sentences, no lists, no Markdown, no links, no reading out long numbers or addresses. If you drafted something that needs approval or showed photos, say in a few words that it is on the screen.'
      : '',
    parts.rollingSummary ? `# Earlier in this conversation (summary)\n${parts.rollingSummary}` : '',
    parts.relevantMemory ? `# Relevant memories\n${parts.relevantMemory}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');
  blocks.push({ type: 'text', text: dynamic });
  return blocks;
}

/** One user turn: retrieve memory, stream, run tools (max 8), stream again… */
export async function runTurn(input: TurnInput): Promise<TurnResult> {
  const { ctx, transport, onEvent } = input;
  const tools = input.tools ?? ALL_TOOLS;
  const now = ctx.now();

  const recentText = input.history
    .slice(-6)
    .map((m) => m.text)
    .join('\n');
  const [memory, situation] = await Promise.all([
    buildMemoryContext(ctx.memory, { query: input.userText, recentText, now }),
    buildSituation(ctx.sources, now).catch(() => ''),
  ]);

  const system = buildSystem({
    coreMemory: memory.core,
    relevantMemory: memory.relevant,
    now,
    dataMode: ctx.sources.mode,
    unavailable: input.unavailableSources,
    rollingSummary: input.rollingSummary,
    situation,
    voice: input.voice,
  });

  const messages = await buildHistory(input.history, input.actions);
  const last = messages[messages.length - 1];
  if (last?.role === 'user' && typeof last.content === 'string') {
    // History ended on an unanswered user turn (e.g. a failed request): merge.
    last.content = `${last.content}\n\n${input.userText}`;
  } else {
    messages.push({ role: 'user', content: input.userText });
  }

  const cards: ChatCard[] = [];
  const apiContent: unknown[] = [];
  let text = '';
  let toolCalls = 0;
  let stopReason: string | null = null;

  for (let round = 0; round < MAX_TOOL_CALLS_PER_REQUEST + 2; round++) {
    if (input.signal?.aborted) throw new LlmError('aborted', 'aborted');
    const budgetLeft = MAX_TOOL_CALLS_PER_REQUEST - toolCalls;
    onEvent({ type: 'thinking' });
    let roundText = '';
    const message: BetaMessage = await transport.stream(
      {
        model: MAIN_MODEL,
        system,
        messages,
        tools: apiTools(tools),
        toolChoice: budgetLeft <= 0 ? { type: 'none' } : { type: 'auto' },
        maxTokens: 16000,
        effort: 'low',
      },
      (delta) => {
        // Separate text from different rounds with a paragraph break.
        if (!roundText && text && !text.endsWith('\n')) {
          text += '\n\n';
          onEvent({ type: 'text', delta: '\n\n' });
        }
        roundText += delta;
        text += delta;
        onEvent({ type: 'text', delta });
      },
      input.signal,
    );
    stopReason = message.stop_reason;
    apiContent.push(...message.content);

    if (message.stop_reason === 'refusal') {
      const note = 'I can’t help with that request.';
      if (!roundText) {
        text += (text ? '\n\n' : '') + note;
        onEvent({ type: 'text', delta: note });
      }
      break;
    }

    const toolUses = message.content.filter((b): b is BetaToolUseBlock => b.type === 'tool_use');
    if (toolUses.length === 0) break;
    if (message.stop_reason === 'max_tokens') {
      const note = '\n\n(My reply was cut off before I could finish. Ask me to continue.)';
      text += note;
      onEvent({ type: 'text', delta: note });
      break;
    }

    // Keep the assistant turn exactly as returned (including thinking blocks) within this turn.
    messages.push({ role: 'assistant', content: message.content as unknown as BetaContentBlockParam[] });

    const results: BetaToolResultBlockParam[] = await Promise.all(
      toolUses.map(async (use, i): Promise<BetaToolResultBlockParam> => {
        if (i >= budgetLeft) {
          return { type: 'tool_result', tool_use_id: use.id, is_error: true, content: `Tool limit of ${MAX_TOOL_CALLS_PER_REQUEST} reached for this request. Answer now with what you have, and say what you couldn't check.` };
        }
        const tool = toolByName(use.name);
        onEvent({ type: 'tool-start', name: use.name, label: toolLabel(use.name) });
        if (!tool) {
          onEvent({ type: 'tool-done', name: use.name, summary: 'Unknown tool', isError: true });
          return { type: 'tool_result', tool_use_id: use.id, is_error: true, content: `No tool named ${use.name}.` };
        }
        const toolInput = (use.input && typeof use.input === 'object' ? use.input : {}) as Record<string, unknown>;
        const outcome = await tool.run(toolInput, ctx).catch((e: unknown) => ({
          content: `TOOL_FAILED: ${e instanceof Error ? e.message : String(e)}. Tell the user it didn't work.`,
          isError: true,
          activity: `${use.name} crashed`,
          cards: undefined,
          suspicious: undefined,
        }));
        await ctx.activity.add({ kind: tool.kind === 'read' ? 'read' : tool.kind === 'memory' ? 'memory' : 'action', tool: use.name, summary: outcome.activity, detail: JSON.stringify(toolInput).slice(0, 500) });
        for (const s of outcome.suspicious ?? []) {
          await ctx.activity.add({ kind: 'suspicious', tool: use.name, summary: `Suspicious ${s.source}: ${s.reason}`, detail: s.excerpt });
          cards.push({ type: 'suspicious', source: s.source, excerpt: s.excerpt, reason: s.reason });
        }
        if (outcome.cards?.length) {
          cards.push(...outcome.cards);
          onEvent({ type: 'cards', cards: [...cards] });
        }
        onEvent({ type: 'tool-done', name: use.name, summary: outcome.activity, isError: !!outcome.isError });
        return { type: 'tool_result', tool_use_id: use.id, content: outcome.content, ...(outcome.isError ? { is_error: true } : {}) };
      }),
    );
    toolCalls += Math.min(toolUses.length, Math.max(budgetLeft, 0));
    messages.push({ role: 'user', content: results });
    if (cards.some((c) => c.type === 'suspicious')) onEvent({ type: 'cards', cards: [...cards] });
  }

  return { text: text.trim(), cards, toolCalls, apiContent, stopReason, usedMemoryIds: memory.usedIds };
}
