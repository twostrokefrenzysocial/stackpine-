import Database from 'better-sqlite3';
import type { Db, SqlParams } from '../../db/types';
import { migrate } from '../../db/schema';

/** In-memory SQLite (with FTS5) implementing the app's Db contract. */
export function createTestDb(): Db {
  const raw = new Database(':memory:');
  let depth = 0;
  const db: Db = {
    async exec(sql) {
      raw.exec(sql);
    },
    async run(sql, params: SqlParams = []) {
      const r = raw.prepare(sql).run(...params);
      return { changes: r.changes, lastInsertRowId: Number(r.lastInsertRowid) };
    },
    async all<T>(sql: string, params: SqlParams = []) {
      const stmt = raw.prepare(sql);
      return (stmt.reader ? stmt.all(...params) : (stmt.run(...params), [])) as T[];
    },
    async get<T>(sql: string, params: SqlParams = []) {
      const stmt = raw.prepare(sql);
      if (!stmt.reader) {
        stmt.run(...params);
        return null;
      }
      return (stmt.get(...params) as T) ?? null;
    },
    async transaction(fn) {
      const name = `sp${depth++}`;
      raw.exec(`SAVEPOINT ${name}`);
      try {
        const result = await fn();
        raw.exec(`RELEASE ${name}`);
        return result;
      } catch (e) {
        raw.exec(`ROLLBACK TO ${name}`);
        raw.exec(`RELEASE ${name}`);
        throw e;
      } finally {
        depth--;
      }
    },
  };
  return db;
}

export async function createMigratedDb(): Promise<Db> {
  const db = createTestDb();
  await migrate(db);
  return db;
}
