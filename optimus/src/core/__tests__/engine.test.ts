import type { BetaMessage } from '@anthropic-ai/sdk/resources/beta/messages/messages';
import { OptimusEngine } from '../engine';
import { HeuristicBackgroundLlm, ScriptedTransport } from '../llm/scripted';
import type { ChatRequest, LlmTransport } from '../llm/transport';
import { createMockSources } from '../mock/sources';
import type { ChatCard } from '../types';
import { createMigratedDb } from './helpers/sqliteDb';
import type { Db } from '../db/types';

const NOW = new Date('2026-10-18T16:00:00');

function makeEngine(db: Db, transport: LlmTransport = new ScriptedTransport({ now: () => NOW })) {
  const sources = createMockSources({ now: () => NOW });
  const engine = new OptimusEngine({
    db,
    sources: () => sources,
    transport: () => transport,
    background: () => new HeuristicBackgroundLlm(),
    now: () => NOW,
  });
  return { engine, sources };
}

const confirmIds = (cards: ChatCard[]) => cards.filter((c): c is Extract<ChatCard, { type: 'confirm' }> => c.type === 'confirm').map((c) => c.actionId);

/** Records requests and answers from a script of canned assistant messages. */
class FakeTransport implements LlmTransport {
  readonly label = 'fake';
  requests: ChatRequest[] = [];
  constructor(private readonly script: (req: ChatRequest, n: number) => Partial<BetaMessage>) {}
  async stream(req: ChatRequest, onText: (d: string) => void): Promise<BetaMessage> {
    this.requests.push(JSON.parse(JSON.stringify(req)));
    const m = this.script(req, this.requests.length - 1);
    for (const b of m.content ?? []) if (b.type === 'text') onText(b.text);
    return { id: 'm', type: 'message', role: 'assistant', model: 'claude-sonnet-5-5', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 }, stop_reason: 'end_turn', content: [], ...m } as BetaMessage;
  }
}

describe('engine (phase acceptance)', () => {
  it('phase 2: a fact told to Optimus persists across restart and is used later', async () => {
    const db = await createMigratedDb();
    const first = makeEngine(db).engine;
    const conv = await first.conversations.create();
    const { result } = await first.send(conv.id, 'Remember that my favorite coffee is a cortado with oat milk', () => {});
    expect(result.text).toBe('Got it.');

    // "Restart": a brand new engine over the same database.
    const fake = new FakeTransport(() => ({ content: [{ type: 'text', text: 'A cortado with oat milk.', citations: null }] }));
    const second = makeEngine(db, fake).engine;
    const conv2 = await second.conversations.create();
    await second.send(conv2.id, 'What coffee should I order for me?', () => {});
    const system = fake.requests[0].system.map((b) => b.text).join('\n');
    expect(system).toMatch(/cortado with oat milk/i);
  });

  it('phase 3: reads the schedule, and creates an event only after approval', async () => {
    const db = await createMigratedDb();
    const { engine, sources } = makeEngine(db);
    const conv = await engine.conversations.create();

    const day = await engine.send(conv.id, "What's on my schedule today?", () => {});
    expect(day.result.text).toMatch(/Q4 roadmap review/);
    expect(day.result.text).toMatch(/3:00 PM/);

    const before = sources.dataset.events.length;
    const draft = await engine.send(conv.id, 'Add lunch with Mike tomorrow', () => {});
    const [actionId] = confirmIds(draft.result.cards);
    expect(actionId).toBeDefined();
    expect(sources.dataset.events.length).toBe(before); // nothing created yet

    await engine.actions.edit(actionId, { location: 'Brew Kettle' });
    const done = await engine.actions.approve(actionId);
    expect(done.status).toBe('executed');
    expect(sources.dataset.events.length).toBe(before + 1);
    expect(sources.dataset.events.some((e) => e.location === 'Brew Kettle')).toBe(true);
  });

  it('phase 3: cancelled actions never run', async () => {
    const db = await createMigratedDb();
    const { engine, sources } = makeEngine(db);
    const conv = await engine.conversations.create();
    const r = await engine.send(conv.id, 'Text Jen saying running 10 minutes late', () => {});
    const [actionId] = confirmIds(r.result.cards);
    await engine.actions.cancel(actionId);
    expect((await engine.actions.approve(actionId)).status).toBe('cancelled');
    expect(sources.sentTexts).toHaveLength(0);
  });

  it('phase 4: "what did I miss?" covers missed calls, texts, email and flags the injection', async () => {
    const db = await createMigratedDb();
    const { engine } = makeEngine(db);
    const conv = await engine.conversations.create();
    const r = await engine.send(conv.id, 'What did I miss?', () => {});
    expect(r.result.text).toMatch(/Missed calls from .*(Linda|Mom)/);
    expect(r.result.text).toMatch(/unread texts/);
    expect(r.result.text).toMatch(/unread emails/);
    expect(r.result.cards.some((c) => c.type === 'suspicious')).toBe(true);
    const flagged = await engine.activity.list({ kind: 'suspicious' });
    expect(flagged.length).toBeGreaterThan(0);
  });

  it('phase 5: replies to email only after approval', async () => {
    const db = await createMigratedDb();
    const { engine, sources } = makeEngine(db);
    const conv = await engine.conversations.create();
    const r = await engine.send(conv.id, 'Reply to Sarah about her email', () => {});
    const [actionId] = confirmIds(r.result.cards);
    expect(actionId).toBeDefined();
    expect(sources.sentEmails).toHaveLength(0);
    const a = await engine.actions.get(actionId);
    expect(String(a?.draft.subject)).toMatch(/^Re: /);
    await engine.actions.approve(actionId);
    expect(sources.sentEmails).toHaveLength(1);
  });

  it('enforces the 8 tool-call limit per request', async () => {
    const db = await createMigratedDb();
    let n = 0;
    const fake = new FakeTransport((req) =>
      req.toolChoice?.type === 'none'
        ? { content: [{ type: 'text', text: 'Here is what I found.', citations: null }] }
        : { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: `t${n++}`, name: 'search_memory', input: { query: 'x' } }, { type: 'tool_use', id: `t${n++}`, name: 'search_memory', input: { query: 'y' } }, { type: 'tool_use', id: `t${n++}`, name: 'search_memory', input: { query: 'z' } }] },
    );
    const { engine } = makeEngine(db, fake);
    const conv = await engine.conversations.create();
    const r = await engine.send(conv.id, 'loop forever', () => {});
    expect(r.result.toolCalls).toBe(8);
    expect(r.result.text).toBe('Here is what I found.');
    expect(fake.requests[fake.requests.length - 1].toolChoice).toEqual({ type: 'none' });
    expect((await engine.activity.list({ kind: 'memory' })).length + (await engine.activity.list({ kind: 'read' })).length).toBe(8);
  });

  it('caches the stable system prompt and wraps third-party data as untrusted', async () => {
    const db = await createMigratedDb();
    const fake = new FakeTransport((_req, i) =>
      i === 0 ? { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name: 'search_email', input: { query: 'sign-in' } }] } : { content: [{ type: 'text', text: 'That email is phishing.', citations: null }] },
    );
    const { engine } = makeEngine(db, fake);
    const conv = await engine.conversations.create();
    await engine.send(conv.id, 'Any security emails?', () => {});
    expect(fake.requests[0].system[0].cache_control).toEqual({ type: 'ephemeral' });
    const toolResult = JSON.stringify(fake.requests[1].messages[fake.requests[1].messages.length - 1]);
    expect(toolResult).toContain('<untrusted_data source=\\"email\\">');
    expect(toolResult).toContain('SECURITY NOTE');
  });

  it('reports missing permissions honestly', async () => {
    const db = await createMigratedDb();
    const sources = createMockSources({ now: () => NOW, denied: { texts: true } });
    const engine = new OptimusEngine({ db, sources: () => sources, transport: () => new ScriptedTransport({ now: () => NOW }), background: () => new HeuristicBackgroundLlm(), now: () => NOW });
    const conv = await engine.conversations.create();
    const r = await engine.send(conv.id, 'Show my latest texts', () => {});
    expect(r.result.text).toMatch(/permission to read text messages/);
  });

  it('background extraction saves user statements and records an episode', async () => {
    const db = await createMigratedDb();
    const { engine } = makeEngine(db);
    const conv = await engine.conversations.create();
    await engine.conversations.addMessage(conv.id, { role: 'user', text: 'My name is Marco and I live in Lakewood' });
    await engine.conversations.addMessage(conv.id, { role: 'assistant', text: 'Noted.' });
    const n = await engine.processIdleConversations();
    expect(n).toBe(1);
    expect((await engine.memory.search('Marco')).length).toBe(1);
    expect(await engine.episodes.recent()).toHaveLength(1);
    expect(await engine.conversations.unprocessed()).toHaveLength(0);
  });

  it('wipeAll removes everything including memories', async () => {
    const db = await createMigratedDb();
    const { engine } = makeEngine(db);
    const conv = await engine.conversations.create();
    await engine.send(conv.id, 'Remember that I hate cilantro', () => {});
    expect(await engine.memory.count()).toBe(1);
    await engine.wipeAll();
    expect(await engine.memory.count()).toBe(0);
    expect(await engine.conversations.list()).toHaveLength(0);
  });
});
