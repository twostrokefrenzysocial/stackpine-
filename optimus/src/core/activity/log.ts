import type { Db } from '../db/types';
import type { ActivityEntry } from '../types';
import { newId } from '../util/id';

export class ActivityLog {
  constructor(private readonly db: Db) {}

  async add(e: Omit<ActivityEntry, 'id' | 'at'> & { at?: string }): Promise<ActivityEntry> {
    const entry: ActivityEntry = { id: newId('act_'), at: e.at ?? new Date().toISOString(), ...e };
    await this.db.run('INSERT INTO activity(id, at, kind, tool, summary, detail) VALUES(?,?,?,?,?,?)', [
      entry.id,
      entry.at,
      entry.kind,
      entry.tool ?? null,
      entry.summary,
      entry.detail ?? null,
    ]);
    return entry;
  }

  async list(opts: { kind?: ActivityEntry['kind']; limit?: number } = {}): Promise<ActivityEntry[]> {
    const rows = await this.db.all<Record<string, string | null>>(
      `SELECT * FROM activity ${opts.kind ? 'WHERE kind = ?' : ''} ORDER BY at DESC LIMIT ?`,
      opts.kind ? [opts.kind, opts.limit ?? 200] : [opts.limit ?? 200],
    );
    return rows.map((r) => ({
      id: r.id!,
      at: r.at!,
      kind: r.kind as ActivityEntry['kind'],
      tool: r.tool ?? undefined,
      summary: r.summary!,
      detail: r.detail ?? undefined,
    }));
  }

  async prune(olderThanDays: number, now = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - olderThanDays * 86_400_000).toISOString();
    const r = await this.db.run('DELETE FROM activity WHERE at < ?', [cutoff]);
    return r.changes;
  }
}
