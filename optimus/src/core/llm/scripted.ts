import type {
  BetaContentBlock,
  BetaMessage,
  BetaMessageParam,
  BetaToolResultBlockParam,
} from '@anthropic-ai/sdk/resources/beta/messages/messages';
import { z } from 'zod';
import { addDays } from '../util/time';
import type { BackgroundLlm } from './background';
import type { ChatRequest, LlmTransport } from './transport';

/**
 * Offline "demo brain" used when no proxy is configured. It plans tool calls
 * with simple keyword rules so every screen, tool, card and approval flow can
 * be exercised in Mock Data Mode without an API key. The UI labels it clearly.
 * It never pretends to be Claude.
 */

type Plan = { tool: string; input: Record<string, unknown> } | { text: string };

let seq = 0;
const id = (p: string) => `${p}_demo_${Date.now().toString(36)}${(seq++).toString(36)}`;

function lastUser(messages: BetaMessageParam[]): BetaMessageParam | undefined {
  for (let i = messages.length - 1; i >= 0; i--) if (messages[i].role === 'user') return messages[i];
  return undefined;
}

function userText(messages: BetaMessageParam[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === 'user' && typeof m.content === 'string') return m.content.split('\n\n').pop() ?? m.content;
  }
  return '';
}

function resultText(r: BetaToolResultBlockParam): string {
  if (typeof r.content === 'string') return r.content;
  return (r.content ?? []).map((b) => (b.type === 'text' ? b.text : '')).join('\n');
}

/** Pulls the JSON payload out of an <untrusted_data> wrapper (or raw JSON). */
function payload(text: string): unknown {
  const m = text.match(/<untrusted_data[^>]*>\n([\s\S]*)\n<\/untrusted_data>/);
  const body = m ? m[1] : text;
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

function time(iso: string): string {
  const d = new Date(iso);
  let h = d.getHours();
  const ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${String(d.getMinutes()).padStart(2, '0')} ${ap}`;
}

function nextMorning(now: Date): string {
  const d = addDays(now, 1);
  d.setHours(9, 0, 0, 0);
  return d.toISOString();
}

function guessCategory(fact: string): string {
  const f = fact.toLowerCase();
  if (/\b(wife|husband|mom|dad|son|daughter|friend|boss|brother|sister)\b/.test(f)) return 'People';
  if (/\b(birthday|anniversary)\b/.test(f)) return 'Important Dates';
  if (/\b(every|each|usually|always)\b/.test(f)) return 'Routines';
  if (/\b(like|love|prefer|hate|favorite|favourite)\b/.test(f)) return 'Preferences';
  if (/\b(goal|training|project|learning|planning)\b/.test(f)) return 'Projects and Goals';
  if (/\b(live|lives|office|gym)\b/.test(f)) return 'Places';
  return 'About Me';
}

function thirdPerson(fact: string): string {
  const verb = (v: string) => (/(s|sh|ch|x)$/.test(v) ? `${v}es` : /[^aeiou]y$/.test(v) ? `${v.slice(0, -1)}ies` : `${v}s`);
  return fact
    .replace(/^(that\s+)/i, '')
    .replace(/^my\s+/i, '')
    .replace(/^I am\b|^I'm\b/i, 'Is')
    .replace(/^I (\w+)/, (_m, v: string) => verb(v))
    .replace(/\bmy\b/gi, 'their')
    .replace(/\bI\b/g, 'they')
    .replace(/^./, (c) => c.toUpperCase())
    .replace(/[.!]+$/, '');
}

function planFromUser(text: string, now: Date): Plan {
  const t = text.toLowerCase();
  const remember = text.match(/remember(?: that)?[:,]?\s+(.+)/i);
  if (remember) return { tool: 'save_memory', input: { category: guessCategory(remember[1]), content: thirdPerson(remember[1]), importance: 3 } };
  if (/what do you know about me/.test(t)) return { tool: 'search_memory', input: { query: 'me my I family wife work home likes' } };
  if (/\bforget\b/.test(t)) return { tool: 'search_memory', input: { query: text.replace(/.*forget( about)?( that)?/i, '') } };
  if (/what did (we|i) (talk|discuss|say)/.test(t)) return { tool: 'search_past_conversations', input: { query: text.replace(/.*about/i, '') || text } };
  if (/(what did i miss|catch me up|anything i missed|missed)/.test(t)) return { tool: 'catch_up', input: {} };
  if (/remind me/.test(t)) {
    const what = text.replace(/.*remind me (to )?/i, '').replace(/\b(tomorrow|tonight|later)\b.*$/i, '').trim();
    return { tool: 'propose_reminder', input: { text: what || text, due_at: nextMorning(now) } };
  }
  const textTo = text.match(/\btext\s+(.+?)\s+(?:saying|that|to say)\s+(.+)/i);
  if (textTo) return { tool: 'propose_send_text', input: { to: textTo[1], body: textTo[2].replace(/^["“]|["”]$/g, '') } };
  const callTo = text.match(/\bcall\s+(.+?)[.?!]*$/i);
  if (callTo && !/\bcalendar\b/.test(t)) return { tool: 'propose_call', input: { to: callTo[1] } };
  const replyTo = text.match(/repl(?:y|ies) to\s+(\w+)/i);
  if (replyTo && /email|mail|her|him/.test(t)) return { tool: 'search_email', input: { from: replyTo[1], limit: 3 } };
  if (/\b(lunch|dinner|meeting|event|appointment)\b.*\b(with|at|on|tomorrow|friday|monday|tuesday|wednesday|thursday)\b/.test(t) && /\b(add|create|schedule|book|set up|put)\b/.test(t)) {
    const start = new Date(nextMorning(now));
    start.setHours(12, 30, 0, 0);
    const title = text
      .replace(/^(please )?(add|create|schedule|book|set up|put)( a| an)?\s*/i, '')
      .replace(/\s+(tomorrow|on .*)$/i, '')
      .replace(/^./, (c) => c.toUpperCase());
    return { tool: 'propose_create_event', input: { title, start: start.toISOString() } };
  }
  if (/\b(photo|picture|pic)\b/.test(t)) return { tool: 'find_photos', input: { limit: 40 } };
  if (/\b(email|inbox|mail)\b/.test(t)) return { tool: 'search_email', input: { unread_only: true, limit: 10 } };
  if (/\b(text|texts|messages)\b/.test(t)) return { tool: 'recent_text_threads', input: { limit: 8 } };
  if (/\b(calls?|call log)\b/.test(t)) return { tool: 'get_call_log', input: { limit: 10 } };
  if (/\b(schedule|calendar|today|meeting|agenda|busy|free)\b/.test(t)) return { tool: 'get_calendar_events', input: {} };
  if (/\b(who is|who's)\b/.test(t)) return { tool: 'lookup_contact', input: { query: text.replace(/.*who(?: is|'s)\s+/i, '').replace(/[?.]/g, '') } };
  if (/^(hi|hey|hello|good (morning|afternoon|evening))\b/.test(t)) return { text: 'Standing by. Ask me about your day, your messages, or anything you want me to remember.' };
  return { text: 'I’m running on the offline demo brain right now, so I can only handle the basics: your schedule, what you missed, texts, email, photos, reminders and memory. Connect the proxy in Settings for full conversation.' };
}

function planFromResults(tool: string, results: BetaToolResultBlockParam[], userQ: string, captions: (id: string) => string | undefined): Plan {
  const raw = results.map(resultText).join('\n');
  if (results.some((r) => r.is_error)) {
    const msg = raw.replace(/^(ACCESS_UNAVAILABLE|TOOL_FAILED): /, '').split(' Tell the user')[0];
    return { text: `I couldn’t do that: ${msg}` };
  }
  const data = payload(raw) as Record<string, unknown> | unknown[] | null;
  const warn = /SECURITY NOTE/.test(raw) ? '\n\nHeads up: one of those messages tries to give me instructions. I’ve ignored it — it looks like a phishing attempt.' : '';
  switch (tool) {
    case 'save_memory':
      return { text: raw.startsWith('Memory') ? 'Got it.' : raw.replace(/^NOT SAVED: /, 'I didn’t save that: ') };
    case 'search_memory': {
      if (!Array.isArray(data) || !data.length) return { text: 'I don’t have anything stored about that yet.' };
      if (/forget/i.test(userQ)) {
        const first = data[0] as { id: string };
        return { tool: 'forget_memory', input: { id: first.id } };
      }
      return { text: `Here’s what I know:\n${(data as { content: string; person?: string }[]).slice(0, 8).map((m) => `• ${m.person ? `${m.person}: ` : ''}${m.content}`).join('\n')}` };
    }
    case 'forget_memory':
      return { text: 'Ready to forget it — approve the card to confirm.' };
    case 'search_past_conversations':
      return { text: raw.startsWith('Nothing') ? 'I don’t find that in our past conversations.' : `From our past conversations: ${((data as { summaries?: { summary: string }[] })?.summaries ?? []).map((s) => s.summary).join(' ') || 'I found a few mentions; open History to see them.'}` };
    case 'catch_up': {
      const d = (data ?? {}) as { missed_calls?: { who: string }[]; unread_texts?: { from: string; text: string }[]; unread_emails?: { from: string; subject: string }[]; rest_of_today?: { title: string; start: string }[]; cannot_see?: string[] };
      const parts: string[] = [];
      if (d.missed_calls?.length) parts.push(`Missed calls from ${[...new Set(d.missed_calls.map((c) => c.who))].join(', ')}.`);
      if (d.unread_texts?.length) parts.push(`${d.unread_texts.length} unread texts — ${d.unread_texts.slice(0, 3).map((x) => `${x.from}: “${x.text.slice(0, 60)}”`).join('; ')}.`);
      if (d.unread_emails?.length) parts.push(`${d.unread_emails.length} unread emails, including ${d.unread_emails.slice(0, 2).map((e) => `“${e.subject}”`).join(' and ')}.`);
      if (d.rest_of_today?.length) parts.push(`Still today: ${d.rest_of_today.map((e) => `${e.title} at ${time(e.start)}`).join(', ')}.`);
      if (d.cannot_see?.length) parts.push(`I couldn’t check: ${d.cannot_see.join(', ')}.`);
      return { text: (parts.join('\n\n') || 'Nothing new. You’re clear.') + warn };
    }
    case 'get_calendar_events': {
      if (!Array.isArray(data) || !data.length) return { text: 'Your calendar is clear.' };
      return { text: `Here’s your day:\n${(data as { title: string; start: string; notes?: string }[]).map((e) => `• ${time(e.start)} — ${e.title}${e.notes?.match(/moved from[^.]*/i) ? ` (${e.notes.match(/moved from[^.]*/i)![0].replace(/^M/, 'm')})` : ''}`).join('\n')}` };
    }
    case 'recent_text_threads':
    case 'search_texts':
      if (!Array.isArray(data) || !data.length) return { text: 'No texts there.' };
      return { text: `Latest texts:\n${(data as { from: string; text: string }[]).slice(0, 6).map((m) => `• ${m.from}: “${m.text.slice(0, 80)}”`).join('\n')}${warn}` };
    case 'get_call_log':
      if (!Array.isArray(data) || !data.length) return { text: 'No calls logged.' };
      return { text: `Recent calls:\n${(data as { who: string; type: string; date: string }[]).slice(0, 6).map((c) => `• ${c.who} — ${c.type}, ${time(c.date)}`).join('\n')}` };
    case 'search_email': {
      if (!Array.isArray(data) || !data.length) return { text: 'No matching email.' };
      const list = data as { id: string; from: string; subject: string }[];
      if (/repl(y|ies) to/i.test(userQ)) {
        const e = list[0];
        const name = e.from.split(/[<@]/)[0].trim().split(' ')[0];
        return { tool: 'propose_send_email', input: { to: [e.from.match(/<(.+)>/)?.[1] ?? e.from], subject: `Re: ${e.subject.replace(/^Re:\s*/i, '')}`, body: `Hi ${name},\n\nThanks for sending this — I’ll take a proper look today and get you my thoughts by tomorrow.\n\nBest`, in_reply_to_id: e.id } };
      }
      return { text: `Unread email:\n${list.slice(0, 6).map((e) => `• ${e.from.split('<')[0].trim()}: ${e.subject}`).join('\n')}${warn}` };
    }
    case 'find_photos': {
      if (!Array.isArray(data) || !data.length) return { text: 'No photos found.' };
      const words = userQ.toLowerCase().split(/\W+/).filter((w) => w.length > 3);
      const ranked = (data as { id: string }[])
        .map((p) => ({ id: p.id, score: words.filter((w) => captions(p.id)?.toLowerCase().includes(w)).length }))
        .sort((a, b) => b.score - a.score);
      return { tool: 'look_at_photos', input: { ids: ranked.slice(0, 3).map((r) => r.id) } };
    }
    case 'look_at_photos': {
      const ids = [...raw.matchAll(/Photo (\S+) —/g)].map((m) => m[1]);
      const best = ids[0];
      return { text: best ? `Found it — ${captions(best) ?? 'this one'}.` : 'I couldn’t find a match.' };
    }
    case 'propose_send_text':
    case 'propose_send_email':
    case 'propose_create_event':
    case 'propose_call':
    case 'propose_reminder':
      return { text: 'Draft is ready — approve it when you’re happy with it.' };
    case 'lookup_contact': {
      const list = Array.isArray(data) ? (data as { name: string; relationship?: string; phones: string[] }[]) : [];
      return { text: list.length ? `${list[0].name}${list[0].relationship ? ` — your ${list[0].relationship}` : ''}. ${list[0].phones[0] ?? ''}` : 'I don’t have them in your contacts.' };
    }
    default:
      return { text: 'Done.' };
  }
}

export class ScriptedTransport implements LlmTransport {
  readonly label = 'Offline demo brain';
  constructor(
    private readonly opts: { now?: () => Date; captions?: (photoId: string) => string | undefined; delayMs?: number } = {},
  ) {}

  async stream(req: ChatRequest, onText: (delta: string) => void, signal?: AbortSignal): Promise<BetaMessage> {
    const now = this.opts.now?.() ?? new Date();
    const last = lastUser(req.messages);
    let plan: Plan;
    if (last && Array.isArray(last.content) && last.content.some((b) => b.type === 'tool_result')) {
      const prev = req.messages[req.messages.length - 2];
      const toolUse = Array.isArray(prev?.content) ? prev.content.find((b) => b.type === 'tool_use') : undefined;
      const toolName = toolUse && 'name' in toolUse ? String(toolUse.name) : '';
      plan = planFromResults(toolName, last.content.filter((b): b is BetaToolResultBlockParam => b.type === 'tool_result'), userText(req.messages), this.opts.captions ?? (() => undefined));
      if (req.toolChoice?.type === 'none' && 'tool' in plan) plan = { text: 'I’ve hit my lookup limit for this request — here’s what I have so far.' };
    } else {
      plan = planFromUser(userText(req.messages), now);
    }

    const content: BetaContentBlock[] = [];
    if ('text' in plan) {
      for (const chunk of plan.text.match(/.{1,12}(\s|$)|.+/gs) ?? []) {
        if (signal?.aborted) break;
        onText(chunk);
        if (this.opts.delayMs) await new Promise((r) => setTimeout(r, this.opts.delayMs));
      }
      content.push({ type: 'text', text: plan.text, citations: null } as BetaContentBlock);
    } else {
      content.push({ type: 'tool_use', id: id('toolu'), name: plan.tool, input: plan.input } as BetaContentBlock);
    }
    return {
      id: id('msg'),
      type: 'message',
      role: 'assistant',
      model: 'offline-demo',
      content,
      stop_reason: 'text' in plan ? 'end_turn' : 'tool_use',
      stop_sequence: null,
      usage: { input_tokens: 0, output_tokens: 0 },
    } as unknown as BetaMessage;
  }
}

/** Offline stand-in for Haiku: keeps the pipeline working with simple rules. */
export class HeuristicBackgroundLlm implements BackgroundLlm {
  readonly label = 'Offline heuristics';
  async json<T>(task: { name: string; prompt: string; schema: z.ZodType<T> }): Promise<T> {
    if (task.name === 'rolling_summary') {
      const lines = task.prompt.split('\n').filter((l) => /^(USER|OPTIMUS):/.test(l));
      return task.schema.parse({ summary: lines.slice(-8).map((l) => l.slice(0, 160)).join(' ') });
    }
    if (task.name === 'extract_memories') {
      const userLines = task.prompt
        .split('\n')
        .filter((l) => l.startsWith('USER:'))
        .map((l) => l.slice(5).trim());
      const facts = userLines
        .map((l) => l.match(/\b(?:remember(?: that)?|my name is|i live in|i work at|my favorite)\b[:,]?\s*(.+)/i))
        .filter((m): m is RegExpMatchArray => !!m)
        .map((m) => {
          const raw = /^my name is|^i live|^i work|^my favorite/i.test(m[0]) ? m[0] : m[1];
          return { category: guessCategory(raw), content: thirdPerson(raw), importance: 3, origin: 'user_statement', person_name: null, aliases: [] };
        });
      const first = userLines[0] ?? 'Conversation';
      return task.schema.parse({
        title: first.split(/\s+/).slice(0, 5).join(' ').replace(/[?.!,]$/, ''),
        facts,
        episode: { summary: `The user asked: ${userLines.slice(0, 3).join(' / ').slice(0, 300)}`, decisions: [], open_tasks: [], topics: [...new Set(first.match(/\b[A-Z][a-z]+\b/g) ?? [])].slice(0, 5) },
      });
    }
    if (task.name === 'insights') {
      // Offline demo: missed calls and people waiting become suggestions.
      const m = task.prompt.match(/\{[\s\S]*\}/);
      const data = (m ? JSON.parse(m[0]) : {}) as { missed_calls?: { from: string }[]; waiting_texts?: { from: string; text: string }[] };
      const out: { title: string; why: string; ask: string; priority: 'high' | 'normal' }[] = [];
      for (const c of (data.missed_calls ?? []).slice(0, 1)) out.push({ title: `Call ${c.from} back`, why: `You missed a call from ${c.from}.`, ask: `Call ${c.from}`, priority: 'normal' });
      for (const t of (data.waiting_texts ?? []).slice(0, 2)) out.push({ title: `Reply to ${t.from}`, why: `${t.from} texted: “${t.text.slice(0, 80)}”`, ask: `Draft a reply to ${t.from}`, priority: 'normal' });
      return task.schema.parse({ suggestions: out });
    }
    if (task.name === 'daily_routine') {
      // Offline demo: no writing model, so repeat the instruction itself.
      const p = JSON.parse(task.prompt) as { instruction: string; days_needed: number };
      return task.schema.parse({ days: Array.from({ length: p.days_needed }, () => ({ title: 'Daily', body: `${p.instruction} (Demo: connect the AI in Settings for fresh content each day.)` })) });
    }
    throw new Error(`No offline heuristic for ${task.name}`);
  }
}
