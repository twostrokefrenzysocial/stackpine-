import { z } from 'zod';
import type { Db } from '../db/types';
import type { BackgroundLlm } from '../llm/background';
import { newId } from '../util/id';
import { isoDay } from '../util/time';

/**
 * Daily routines: "every morning at 7, send me a different Bible verse".
 * The user approves a routine once. Optimus then writes fresh content for
 * the coming days ahead of time and schedules each one as an ordinary local
 * notification, so it arrives on time even if the app hasn't been opened.
 * Each app open or background run tops the queue back up.
 */

export interface Routine {
  id: string;
  title: string;
  /** What to write each day, in the user's words. */
  instruction: string;
  /** Local time, "07:00". */
  time: string;
  createdAt: string;
}

export interface RoutineScheduler {
  schedule(n: { title: string; body: string; at: Date; routineId: string }): Promise<string>;
  cancel(notificationId: string): Promise<void>;
}

export const noopRoutineScheduler: RoutineScheduler = {
  async schedule() {
    return `noop-${Date.now()}`;
  },
  async cancel() {},
};

/** How many days ahead are written and scheduled. */
export const ROUTINE_DAYS_AHEAD = 7;

const ItemsSchema = z.object({ days: z.array(z.object({ title: z.string(), body: z.string() })) });

export function parseTime(time: string): { h: number; m: number } | null {
  const m = time.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h < 24 && min < 60 ? { h, m: min } : null;
}

/** The next `count` delivery times at `time`, starting today if it hasn't passed. */
export function upcomingTimes(time: string, now: Date, count: number): Date[] {
  const t = parseTime(time);
  if (!t) return [];
  const first = new Date(now);
  first.setHours(t.h, t.m, 0, 0);
  if (first.getTime() <= now.getTime() + 60_000) first.setDate(first.getDate() + 1);
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(first);
    d.setDate(first.getDate() + i);
    return d;
  });
}

export class RoutineStore {
  constructor(
    private readonly db: Db,
    private scheduler: RoutineScheduler = noopRoutineScheduler,
  ) {}

  setScheduler(s: RoutineScheduler) {
    this.scheduler = s;
  }

  async create(input: { title: string; instruction: string; time: string }, now = new Date()): Promise<Routine> {
    if (!parseTime(input.time)) throw new Error('That time isn’t valid. Use a time like 07:00.');
    const r: Routine = { id: newId('rtn_'), title: input.title.trim() || 'Daily', instruction: input.instruction.trim(), time: input.time.trim().padStart(5, '0'), createdAt: now.toISOString() };
    await this.db.run('INSERT INTO routines(id, title, instruction, time, created_at) VALUES(?,?,?,?,?)', [r.id, r.title, r.instruction, r.time, r.createdAt]);
    return r;
  }

  async list(): Promise<Routine[]> {
    const rows = await this.db.all<Record<string, unknown>>('SELECT * FROM routines ORDER BY time');
    return rows.map((r) => ({ id: String(r.id), title: String(r.title), instruction: String(r.instruction), time: String(r.time), createdAt: String(r.created_at) }));
  }

  async get(id: string): Promise<Routine | null> {
    return (await this.list()).find((r) => r.id === id) ?? null;
  }

  /** Stops a routine: cancels everything already scheduled and forgets it. */
  async remove(id: string): Promise<boolean> {
    const items = await this.db.all<{ notification_id: string | null }>('SELECT notification_id FROM routine_items WHERE routine_id = ?', [id]);
    for (const i of items) if (i.notification_id) await this.scheduler.cancel(i.notification_id).catch(() => undefined);
    await this.db.run('DELETE FROM routine_items WHERE routine_id = ?', [id]);
    const before = (await this.list()).length;
    await this.db.run('DELETE FROM routines WHERE id = ?', [id]);
    return (await this.list()).length < before;
  }

  /** Recently delivered or queued content, newest first (to avoid repeats). */
  async history(routineId: string, limit = 40): Promise<{ date: string; title: string; body: string }[]> {
    return this.db.all('SELECT date, title, body FROM routine_items WHERE routine_id = ? ORDER BY date DESC LIMIT ?', [routineId, limit]);
  }

  /**
   * Writes and schedules content for any of the next ROUTINE_DAYS_AHEAD days
   * that don't have it yet. Returns how many notifications were added.
   */
  async refill(routine: Routine, llm: BackgroundLlm | undefined, now = new Date()): Promise<number> {
    const times = upcomingTimes(routine.time, now, ROUTINE_DAYS_AHEAD);
    const have = new Set((await this.db.all<{ date: string }>('SELECT date FROM routine_items WHERE routine_id = ? AND date >= ?', [routine.id, isoDay(now)])).map((r) => r.date));
    const missing = times.filter((t) => !have.has(isoDay(t)));
    if (!missing.length) return 0;
    const past = await this.history(routine.id);
    let days: { title: string; body: string }[] = [];
    if (llm) {
      try {
        const r = await llm.json({
          name: 'daily_routine',
          system:
            'You write short daily phone notifications for Optimus, a calm personal assistant. Follow the user’s instruction exactly. Each day must be different from every other day and from the recent ones listed. Title: under 40 characters. Body: under 300 characters, plain text, no emoji, no markdown. Quote any scripture or text accurately in the translation asked for.',
          prompt: JSON.stringify({ instruction: routine.instruction, days_needed: missing.length, dates: missing.map((d) => isoDay(d)), recent_do_not_repeat: past.map((p) => `${p.title}: ${p.body.slice(0, 80)}`) }),
          schema: ItemsSchema,
          maxTokens: 6000,
        });
        days = r.days;
      } catch {
        days = [];
      }
    }
    let added = 0;
    for (let i = 0; i < missing.length; i++) {
      const at = missing[i];
      const item = days[i];
      // Without fresh content for a day, leave it unscheduled so a later refill can write it.
      if (!item) continue;
      const notificationId = await this.scheduler.schedule({ title: item.title.slice(0, 60), body: item.body.slice(0, 400), at, routineId: routine.id });
      await this.db.run('INSERT INTO routine_items(id, routine_id, date, title, body, notification_id) VALUES(?,?,?,?,?,?)', [newId('rti_'), routine.id, isoDay(at), item.title, item.body, notificationId]);
      added++;
    }
    return added;
  }

  private running: Promise<number> | null = null;

  /** Tops up every routine. Safe to call often; overlapping calls share one run. */
  refillAll(llm: BackgroundLlm | undefined, now = new Date()): Promise<number> {
    this.running ??= (async () => {
      try {
        let n = 0;
        for (const r of await this.list()) n += await this.refill(r, llm, now).catch(() => 0);
        return n;
      } finally {
        this.running = null;
      }
    })();
    return this.running;
  }
}
