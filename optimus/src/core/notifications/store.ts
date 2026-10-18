import type { Db } from '../db/types';
import type { CapturedNotification } from '../types';
import { DAY } from '../util/time';
import { redactNotification } from './redact';

export interface RawCapturedNotification {
  key: string;
  packageName: string;
  appName: string;
  title: string;
  text: string;
  postedAtMs: number;
  category: string | null;
  redacted: boolean;
}

export interface IngestPolicy {
  excludedPackages: string[];
  retentionDays: number;
}

const toNotif = (r: Record<string, unknown>): CapturedNotification => ({
  id: String(r.id),
  packageName: String(r.package_name),
  appName: String(r.app_name),
  title: String(r.title),
  text: String(r.text),
  postedAt: String(r.posted_at),
  category: (r.category as string) ?? undefined,
  redacted: r.redacted === 1,
});

/** Local, encrypted-at-rest store of captured notifications ("what did I miss?"). */
export class NotificationStore {
  constructor(private readonly db: Db) {}

  /**
   * Stores notifications drained from the native listener. Excluded apps are
   * dropped, codes are redacted (again), duplicates are skipped.
   */
  async ingest(items: RawCapturedNotification[], policy: IngestPolicy, now = new Date()): Promise<number> {
    const excluded = new Set(policy.excludedPackages);
    const cutoff = now.getTime() - policy.retentionDays * DAY;
    let stored = 0;
    await this.db.transaction(async () => {
      for (const n of items) {
        if (excluded.has(n.packageName) || n.postedAtMs < cutoff) continue;
        const clean = redactNotification(n.title, n.text);
        const id = `${n.key}@${n.postedAtMs}`;
        const r = await this.db.run(
          `INSERT OR IGNORE INTO notifications(id, package_name, app_name, title, text, posted_at, category, redacted)
           VALUES(?,?,?,?,?,?,?,?)`,
          [
            id,
            n.packageName,
            n.appName,
            clean.title,
            clean.text,
            new Date(n.postedAtMs).toISOString(),
            n.category,
            n.redacted || clean.redacted ? 1 : 0,
          ],
        );
        stored += r.changes;
      }
    });
    return stored;
  }

  async list(q: { app?: string; query?: string; since?: string; until?: string; limit?: number } = {}): Promise<CapturedNotification[]> {
    const where: string[] = ['posted_at >= ?', 'posted_at <= ?'];
    const params: (string | number)[] = [q.since ?? '0000', q.until ?? '9999'];
    if (q.app) {
      where.push('(LOWER(app_name) LIKE ? OR LOWER(package_name) LIKE ?)');
      params.push(`%${q.app.toLowerCase()}%`, `%${q.app.toLowerCase()}%`);
    }
    if (q.query) {
      where.push('(LOWER(title) LIKE ? OR LOWER(text) LIKE ?)');
      params.push(`%${q.query.toLowerCase()}%`, `%${q.query.toLowerCase()}%`);
    }
    params.push(q.limit ?? 30);
    const rows = await this.db.all<Record<string, unknown>>(
      `SELECT * FROM notifications WHERE ${where.join(' AND ')} ORDER BY posted_at DESC LIMIT ?`,
      params,
    );
    return rows.map(toNotif);
  }

  /** Deletes notifications older than the retention window, and any from apps now excluded. */
  async prune(policy: IngestPolicy, now = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - policy.retentionDays * DAY).toISOString();
    let removed = (await this.db.run('DELETE FROM notifications WHERE posted_at < ?', [cutoff])).changes;
    if (policy.excludedPackages.length) {
      const ph = policy.excludedPackages.map(() => '?').join(',');
      removed += (await this.db.run(`DELETE FROM notifications WHERE package_name IN (${ph})`, policy.excludedPackages)).changes;
    }
    return removed;
  }

  async apps(): Promise<{ packageName: string; appName: string; count: number }[]> {
    return this.db.all('SELECT package_name AS packageName, app_name AS appName, COUNT(*) AS count FROM notifications GROUP BY package_name ORDER BY count DESC');
  }
}
