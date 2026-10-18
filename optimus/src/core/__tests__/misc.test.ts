import Database from 'better-sqlite3';
import { BriefStore, briefDue, generateBrief } from '../brief/brief';
import { ConversationStore, EpisodeStore } from '../conversations/store';
import { ROLLING_WINDOW, maybeRollSummary, unsummarizedMessages } from '../llm/background';
import { HeuristicBackgroundLlm } from '../llm/scripted';
import { MIGRATIONS, migrate, withoutFts5 } from '../db/schema';
import type { Db } from '../db/types';
import { MemoryStore } from '../memory/store';
import { createMockSources } from '../mock/sources';
import { ReminderStore } from '../reminders/reminders';
import { shouldRelock } from '../security/lock';
import { createMigratedDb, createTestDb } from './helpers/sqliteDb';

describe('app lock', () => {
  it('re-locks only after 5 minutes in the background', () => {
    const t0 = 1_000_000;
    expect(shouldRelock(null, t0)).toBe(false);
    expect(shouldRelock(t0, t0 + 4 * 60_000)).toBe(false);
    expect(shouldRelock(t0, t0 + 5 * 60_000)).toBe(true);
  });
});

describe('without FTS5 (browser preview)', () => {
  it('rewrites virtual tables and memory search still works via LIKE', async () => {
    const sql = withoutFts5(MIGRATIONS[0]);
    expect(sql).not.toMatch(/fts5/);
    const raw = new Database(':memory:');
    raw.exec(sql);
    const base = createTestDb();
    // Reuse the adapter but point it at the pre-migrated raw DB.
    const db: Db = { ...base, exec: async (s) => void raw.exec(s), run: async (s, p = []) => { const r = raw.prepare(s).run(...p); return { changes: r.changes, lastInsertRowId: Number(r.lastInsertRowid) }; }, all: async (s, p = []) => raw.prepare(s).all(...p) as never, get: async (s, p = []) => (raw.prepare(s).get(...p) as never) ?? null, transaction: async (fn) => fn() };
    const store = new MemoryStore(db);
    await store.save({ category: 'Preferences', content: 'Prefers aisle seats on long flights', source: 'conversation' });
    const hits = await store.search('which seats on flights?');
    expect(hits).toHaveLength(1);
    expect(hits[0].relevance).toBeGreaterThan(0);
  });
});

describe('daily brief', () => {
  const now = new Date('2026-10-18T07:30:00');
  it('is due after the chosen time when missing', () => {
    expect(briefDue('07:00', now, null)).toBe(true);
    expect(briefDue('08:00', now, null)).toBe(false);
    expect(briefDue('07:00', now, { date: '2026-10-18' } as never)).toBe(false);
    // The background task may build it up to 45 minutes early, ahead of the notification.
    expect(briefDue('08:00', now, null, 45)).toBe(true);
    expect(briefDue('08:30', now, null, 45)).toBe(false);
  });

  it('builds schedule, people waiting and missed calls, skipping suspicious senders', async () => {
    const db = await createMigratedDb();
    const sources = createMockSources({ now: () => now });
    const brief = await generateBrief({ sources, episodes: new EpisodeStore(db), reminders: new ReminderStore(db), now });
    expect(brief.schedule.some((e) => /Q4 roadmap/.test(e.title))).toBe(true);
    expect(brief.peopleWaiting.length).toBeGreaterThan(0);
    expect(brief.peopleWaiting.some((p) => /IT Support|micros0ft/i.test(p.name))).toBe(false);
    const store = new BriefStore(db);
    await store.save(brief);
    expect((await store.forDate('2026-10-18'))?.headline).toBe(brief.headline);
    expect((await store.latest())?.id).toBe(brief.id);
    // Switching data mode clears it, so the demo brief never shows on real data.
    await store.clear();
    expect(await store.forDate('2026-10-18')).toBeNull();
    expect(await store.latest()).toBeNull();
  });
});

it('migrate is idempotent', async () => {
  const db = createTestDb();
  expect(await migrate(db)).toBe(MIGRATIONS.length);
  expect(await migrate(db)).toBe(MIGRATIONS.length);
});

describe('rolling summary', () => {
  it('folds older messages so long conversations keep the thread', async () => {
    const db = await createMigratedDb();
    const conversations = new ConversationStore(db);
    const c = await conversations.create();
    for (let i = 0; i < ROLLING_WINDOW + 6; i++) {
      await conversations.addMessage(c.id, { role: i % 2 ? 'assistant' : 'user', text: `message ${i} about the Chicago trip` });
    }
    expect(await maybeRollSummary({ llm: new HeuristicBackgroundLlm(), conversations }, c.id)).toBe(true);
    const conv = (await conversations.get(c.id))!;
    expect(conv.rollingSummary).toMatch(/Chicago/);
    const rest = unsummarizedMessages(conv, await conversations.messages(c.id));
    expect(rest).toHaveLength(ROLLING_WINDOW / 2);
    expect(await maybeRollSummary({ llm: new HeuristicBackgroundLlm(), conversations }, c.id)).toBe(false);
  });
});
