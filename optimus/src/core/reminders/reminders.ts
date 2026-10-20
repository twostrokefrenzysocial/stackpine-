import type { Db } from "../db/types";
import type { Reminder } from "../types";
import { newId } from "../util/id";

/** Schedules the local notification; implemented with expo-notifications on device. */
export interface ReminderScheduler {
  schedule(r: Reminder): Promise<string>;
  cancel(notificationId: string): Promise<void>;
}

export const noopScheduler: ReminderScheduler = {
  async schedule(r) {
    return `noop-${r.id}`;
  },
  async cancel() {},
};

const toReminder = (r: Record<string, unknown>): Reminder => ({
  id: String(r.id),
  text: String(r.text),
  dueAt: String(r.due_at),
  createdAt: String(r.created_at),
  notificationId: (r.notification_id as string) ?? undefined,
  done: r.done === 1,
  conversationId: (r.conversation_id as string) ?? undefined,
});

export class ReminderStore {
  constructor(
    private readonly db: Db,
    private scheduler: ReminderScheduler = noopScheduler,
  ) {}

  setScheduler(s: ReminderScheduler) {
    this.scheduler = s;
  }

  async create(
    input: { text: string; dueAt: string; conversationId?: string },
    now = new Date(),
  ): Promise<Reminder> {
    const due = new Date(input.dueAt);
    if (Number.isNaN(due.getTime()))
      throw new Error("That reminder time is not a valid date.");
    if (due.getTime() <= now.getTime())
      throw new Error("That reminder time is in the past.");
    const r: Reminder = {
      id: newId("rem_"),
      text: input.text.trim(),
      dueAt: due.toISOString(),
      createdAt: now.toISOString(),
      done: false,
      conversationId: input.conversationId,
    };
    r.notificationId = await this.scheduler.schedule(r);
    await this.db.run(
      "INSERT INTO reminders(id, text, due_at, created_at, notification_id, done, conversation_id) VALUES(?,?,?,?,?,?,?)",
      [
        r.id,
        r.text,
        r.dueAt,
        r.createdAt,
        r.notificationId ?? null,
        0,
        r.conversationId ?? null,
      ],
    );
    return r;
  }

  async upcoming(limit = 20, now = new Date()): Promise<Reminder[]> {
    const rows = await this.db.all<Record<string, unknown>>(
      "SELECT * FROM reminders WHERE done = 0 AND due_at >= ? ORDER BY due_at LIMIT ?",
      [now.toISOString(), limit],
    );
    return rows.map(toReminder);
  }

  /** Cancels and re-creates every pending notification (after a payload change). */
  async rescheduleAll(now = new Date()): Promise<number> {
    let n = 0;
    for (const r of await this.upcoming(500, now)) {
      if (r.notificationId)
        await this.scheduler.cancel(r.notificationId).catch(() => undefined);
      const id = await this.scheduler.schedule(r);
      await this.db.run(
        "UPDATE reminders SET notification_id = ? WHERE id = ?",
        [id, r.id],
      );
      n++;
    }
    return n;
  }

  async all(): Promise<Reminder[]> {
    const rows = await this.db.all<Record<string, unknown>>(
      "SELECT * FROM reminders ORDER BY due_at DESC",
    );
    return rows.map(toReminder);
  }

  async complete(id: string): Promise<void> {
    const row = await this.db.get<Record<string, unknown>>(
      "SELECT * FROM reminders WHERE id = ?",
      [id],
    );
    if (!row) return;
    const r = toReminder(row);
    if (r.notificationId)
      await this.scheduler.cancel(r.notificationId).catch(() => undefined);
    await this.db.run("UPDATE reminders SET done = 1 WHERE id = ?", [id]);
  }
}
