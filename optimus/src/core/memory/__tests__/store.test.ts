import { createMigratedDb } from '../../__tests__/helpers/sqliteDb';
import { MemoryStore } from '../store';
import { buildMemoryContext, rankMemories } from '../retrieval';
import { findForbidden, sensitiveTopic } from '../sensitive';
import type { Memory } from '../../types';

async function setup() {
  const db = await createMigratedDb();
  return { db, store: new MemoryStore(db) };
}

describe('MemoryStore.save', () => {
  it('saves facts stated in conversation immediately', async () => {
    const { store } = await setup();
    const r = await store.save({ category: 'Preferences', content: 'Prefers window seats on flights', source: 'conversation' });
    expect(r.status).toBe('saved');
    expect(await store.count()).toBe(1);
  });

  it('suggests facts learned from data sources instead of saving them', async () => {
    const { store } = await setup();
    const r = await store.save({ category: 'Important Dates', content: 'Anniversary is November 8', source: 'sms' });
    expect(r.status).toBe('pending');
    expect(await store.count()).toBe(0);
    const pending = await store.listPending();
    expect(pending).toHaveLength(1);
    const approved = await store.approvePending(pending[0].id);
    expect(approved.status).toBe('saved');
    expect(await store.listPending()).toHaveLength(0);
  });

  it('does not suggest the same data fact twice', async () => {
    const { store } = await setup();
    await store.save({ category: 'Places', content: 'Gym is Lakewood YMCA', source: 'email' });
    await store.save({ category: 'Places', content: 'Gym is Lakewood YMCA.', source: 'email' });
    expect(await store.listPending()).toHaveLength(1);
  });

  it('holds sensitive facts until confirmed', async () => {
    const { store } = await setup();
    const r = await store.save({ category: 'About Me', content: 'Takes blood pressure medication every morning', source: 'conversation' });
    expect(r.status).toBe('pending');
    if (r.status === 'pending') expect(r.reason).toBe('sensitive');
    const ok = await store.save(
      { category: 'About Me', content: 'Takes blood pressure medication every morning', source: 'conversation' },
      { sensitiveConfirmed: true },
    );
    expect(ok.status).toBe('saved');
    if (ok.status === 'saved') expect(ok.memory.sensitive).toBe(true);
  });

  it('never stores passwords, card numbers, account or ID numbers', async () => {
    const { store } = await setup();
    const bad = [
      'My wifi password is hunter22',
      'Card number 4111 1111 1111 1111',
      'Checking account number 123456789012',
      'My SSN is 123-45-6789',
      'Passport number X12345678',
    ];
    for (const content of bad) {
      const r = await store.save({ category: 'About Me', content, source: 'conversation' }, { approved: true, sensitiveConfirmed: true });
      expect(r.status).toBe('rejected');
    }
    expect(await store.count()).toBe(0);
  });

  it('merges duplicates', async () => {
    const { store } = await setup();
    await store.save({ category: 'Preferences', content: 'Likes oat milk in coffee', source: 'conversation', importance: 2 });
    const r = await store.save({ category: 'Preferences', content: 'likes oat milk in coffee!', source: 'conversation', importance: 4 });
    expect(r.status).toBe('duplicate');
    expect(await store.count()).toBe(1);
    const [m] = await store.list();
    expect(m.importance).toBe(4);
  });

  it('updates a contradicting fact and keeps the previous value', async () => {
    const { store } = await setup();
    await store.save({ category: 'Preferences', content: 'Favorite color is blue', source: 'conversation' });
    const r = await store.save({ category: 'Preferences', content: 'Favorite color is green', source: 'conversation' });
    expect(r.status).toBe('updated');
    const all = await store.list();
    expect(all).toHaveLength(1);
    expect(all[0].content).toBe('Favorite color is green');
    expect(all[0].previousValue).toBe('Favorite color is blue');
  });

  it('keeps one People entry per person, resolving aliases', async () => {
    const { store } = await setup();
    await store.save({
      category: 'People',
      content: 'Wife. Loves tulips',
      personName: 'Jen Ruiz',
      contactId: 'c-jen',
      aliases: ['my wife', 'Jen'],
      source: 'conversation',
    });
    const r = await store.save({ category: 'People', content: 'Allergic to shellfish', personName: 'my wife', source: 'conversation' }, { sensitiveConfirmed: true });
    expect(r.status).toBe('merged');
    const people = await store.list('People');
    expect(people).toHaveLength(1);
    expect(people[0].content).toContain('Loves tulips');
    expect(people[0].content).toContain('Allergic to shellfish');
    expect((await store.findPerson('Jen'))?.id).toBe(people[0].id);
    expect((await store.findPerson('my wife'))?.id).toBe(people[0].id);
    expect((await store.findPerson('', 'c-jen'))?.id).toBe(people[0].id);
  });
});

describe('MemoryStore.forget', () => {
  it('fully deletes a memory and anything derived only from it', async () => {
    const { store, db } = await setup();
    const a = await store.save({ category: 'Places', content: 'Office is at 1200 Euclid Ave', source: 'conversation' });
    const b = await store.save({ category: 'Routines', content: 'Commutes 25 minutes by car', source: 'conversation' });
    if (a.status !== 'saved' || b.status !== 'saved') throw new Error('setup');
    const onlyA = await store.save({ category: 'Routines', content: 'Parks in the Euclid garage', source: 'conversation', derivedFrom: [a.memory.id] });
    const both = await store.save({ category: 'Routines', content: 'Leaves home at 8:10 to reach the office', source: 'conversation', derivedFrom: [a.memory.id, b.memory.id] });
    if (onlyA.status !== 'saved' || both.status !== 'saved') throw new Error('setup');

    const { deleted } = await store.forget(a.memory.id);
    expect(deleted.sort()).toEqual([a.memory.id, onlyA.memory.id].sort());
    expect(await store.get(both.memory.id)).not.toBeNull();
    expect((await store.get(both.memory.id))?.derivedFrom).toEqual([b.memory.id]);
    const fts = await db.all('SELECT * FROM memories_fts WHERE memory_id = ?', [a.memory.id]);
    expect(fts).toHaveLength(0);
    expect(await store.search('Euclid')).toHaveLength(0);
  });
});

describe('retrieval', () => {
  it('includes About Me core facts and relevant memories within budget', async () => {
    const { store } = await setup();
    await store.save({ category: 'About Me', content: 'Name is Chris', source: 'conversation', importance: 5 });
    await store.save({ category: 'About Me', content: 'Lives in Lakewood, Ohio', source: 'conversation', importance: 4 });
    await store.save({ category: 'Projects and Goals', content: 'Training for the Cleveland half marathon in May', source: 'conversation' });
    await store.save({ category: 'Preferences', content: 'Hates early morning meetings', source: 'conversation' });
    const ctx = await buildMemoryContext(store, { query: 'How is my marathon training going?' });
    expect(ctx.core).toContain('Name is Chris');
    expect(ctx.relevant).toContain('half marathon');
    expect(ctx.relevant).not.toContain('early morning');
    expect(ctx.tokens).toBeLessThanOrEqual(1500);
    const used = await store.search('marathon');
    expect(used[0].memory.lastUsedAt).toBeDefined();
  });

  it('respects the token budget', async () => {
    const { store } = await setup();
    const crops = ['tomatoes', 'peppers', 'basil', 'kale', 'carrots', 'onions', 'garlic', 'squash', 'beans', 'lettuce', 'beets', 'mint'];
    const spots = ['north fence', 'patio', 'side yard', 'front porch', 'shed', 'driveway', 'back corner', 'deck'];
    for (const crop of crops) {
      for (const spot of spots) {
        await store.save({ category: 'Projects and Goals', content: `Garden plan: grow ${crop} near the ${spot} with tomatoes as companions`, source: 'conversation' });
      }
    }
    const ctx = await buildMemoryContext(store, { query: 'garden tomatoes', budgetTokens: 300 });
    expect(ctx.tokens).toBeLessThanOrEqual(300);
    expect(ctx.relevant.split('\n').length).toBeGreaterThan(3);
  });

  it('resolves people by alias', async () => {
    const { store } = await setup();
    await store.save({ category: 'People', content: 'Wife; works as a nurse at Fairview', personName: 'Jen Ruiz', aliases: ['my wife'], source: 'conversation' });
    const ctx = await buildMemoryContext(store, { query: 'what should I get my wife?' });
    expect(ctx.relevant).toContain('Jen Ruiz');
  });

  it('ranks by relevance, then importance, then recency', () => {
    const mk = (id: string, importance: Memory['importance'], updatedAt: string): Memory => ({
      id, importance, updatedAt, createdAt: updatedAt, category: 'Preferences', content: id, source: 'conversation',
    });
    const ranked = rankMemories([
      { memory: mk('low-rel', 5, '2026-01-01'), relevance: 0.2 },
      { memory: mk('hi-rel-old', 3, '2025-01-01'), relevance: 0.9 },
      { memory: mk('hi-rel-new', 3, '2026-06-01'), relevance: 0.92 },
      { memory: mk('hi-rel-important', 5, '2024-01-01'), relevance: 0.95 },
    ]);
    expect(ranked.map((m) => m.id)).toEqual(['hi-rel-important', 'hi-rel-new', 'hi-rel-old', 'low-rel']);
  });
});

describe('sensitive guards', () => {
  it('detects forbidden content', () => {
    expect(findForbidden('Gate code is the same as always')).toBeNull();
    expect(findForbidden('Born in 1988')).toBeNull();
    expect(findForbidden('Lives at 14820 Detroit Ave')).toBeNull();
    expect(findForbidden('password: correct-horse')).toBe('password');
  });
  it('detects health and finance topics', () => {
    expect(sensitiveTopic('Has a peanut allergy')).toBe('health');
    expect(sensitiveTopic('Salary is 120k')).toBe('finances');
    expect(sensitiveTopic('Loves hiking')).toBeNull();
  });
});
