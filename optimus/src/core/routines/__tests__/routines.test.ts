import type { BackgroundLlm } from '../../llm/background';
import { createMigratedDb } from '../../__tests__/helpers/sqliteDb';
import { RoutineStore, ROUTINE_DAYS_AHEAD, upcomingTimes, type RoutineScheduler } from '../routines';

const NOW = new Date('2026-10-18T17:10:00');

function fakeScheduler() {
  const scheduled: { id: string; title: string; body: string; at: Date }[] = [];
  const cancelled: string[] = [];
  const s: RoutineScheduler = {
    async schedule(n) {
      const id = `n${scheduled.length}`;
      scheduled.push({ id, title: n.title, body: n.body, at: n.at });
      return id;
    },
    async cancel(id) {
      cancelled.push(id);
    },
  };
  return { s, scheduled, cancelled };
}

const writer = (): BackgroundLlm & { prompts: string[] } => {
  const prompts: string[] = [];
  return {
    label: 'fake',
    prompts,
    async json<T>(task: { prompt: string; schema: { parse: (v: unknown) => T } }) {
      prompts.push(task.prompt);
      const p = JSON.parse(task.prompt) as { dates: string[] };
      return task.schema.parse({ days: p.dates.map((d) => ({ title: 'Morning verse', body: `Verse for ${d}` })) });
    },
  } as BackgroundLlm & { prompts: string[] };
};

describe('daily routines', () => {
  it('starts tomorrow when today’s time has passed', () => {
    const t = upcomingTimes('07:00', NOW, 2);
    expect(t[0].getDate()).toBe(19);
    expect(t[0].getHours()).toBe(7);
    expect(upcomingTimes('18:00', NOW, 1)[0].getDate()).toBe(18);
  });

  it('writes a different message for each of the next days, schedules them, and only fills gaps later', async () => {
    const db = await createMigratedDb();
    const { s, scheduled } = fakeScheduler();
    const store = new RoutineStore(db, s);
    const r = await store.create({ title: 'Morning verse', instruction: 'A different ESV verse about anxiety', time: '07:00' }, NOW);
    const llm = writer();
    expect(await store.refill(r, llm, NOW)).toBe(ROUTINE_DAYS_AHEAD);
    expect(new Set(scheduled.map((x) => x.body)).size).toBe(ROUTINE_DAYS_AHEAD);
    expect(scheduled.every((x) => x.at.getHours() === 7)).toBe(true);
    // Nothing missing: no new writing, no duplicates.
    expect(await store.refill(r, llm, NOW)).toBe(0);
    expect(llm.prompts).toHaveLength(1);
    // Three days later only the new days are written, and past ones are listed to avoid repeats.
    const later = new Date('2026-10-21T08:00:00');
    expect(await store.refill(r, llm, later)).toBe(3);
    expect(llm.prompts[1]).toContain('recent_do_not_repeat');
    expect(llm.prompts[1]).toContain('Verse for 2026-10-19');
  });

  it('schedules nothing for a day the writer failed on, so a later run can fill it', async () => {
    const db = await createMigratedDb();
    const { s, scheduled } = fakeScheduler();
    const store = new RoutineStore(db, s);
    const r = await store.create({ title: 'Quote', instruction: 'A quote', time: '07:00' }, NOW);
    const failing = { label: 'x', json: async () => Promise.reject(new Error('offline')) } as unknown as BackgroundLlm;
    expect(await store.refill(r, failing, NOW)).toBe(0);
    expect(scheduled).toHaveLength(0);
  });

  it('stopping a routine cancels everything scheduled', async () => {
    const db = await createMigratedDb();
    const { s, cancelled } = fakeScheduler();
    const store = new RoutineStore(db, s);
    const r = await store.create({ title: 'Verse', instruction: 'x', time: '07:00' }, NOW);
    await store.refill(r, writer(), NOW);
    expect(await store.remove(r.id)).toBe(true);
    expect(cancelled).toHaveLength(ROUTINE_DAYS_AHEAD);
    expect(await store.list()).toEqual([]);
  });
});
