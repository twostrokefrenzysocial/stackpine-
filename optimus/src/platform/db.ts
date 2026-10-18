import * as SQLite from 'expo-sqlite';
import { Platform } from 'react-native';
import type { Db, SqlParams } from '../core/db/types';
import { migrate } from '../core/db/schema';
import { getOrCreateDbKey } from './secrets';

const DB_NAME = 'optimus.db';

/** Wraps expo-sqlite in the app's Db contract. */
function adapt(raw: SQLite.SQLiteDatabase): Db {
  let depth = 0;
  return {
    exec: (sql) => raw.execAsync(sql),
    async run(sql, params: SqlParams = []) {
      const r = await raw.runAsync(sql, params);
      return { changes: r.changes, lastInsertRowId: r.lastInsertRowId };
    },
    all: <T,>(sql: string, params: SqlParams = []) => raw.getAllAsync<T>(sql, params),
    get: async <T,>(sql: string, params: SqlParams = []) => (await raw.getFirstAsync<T>(sql, params)) ?? null,
    async transaction(fn) {
      // Savepoints nest, so stores can call each other inside transactions.
      const name = `sp${depth++}`;
      await raw.execAsync(`SAVEPOINT ${name}`);
      try {
        const result = await fn();
        await raw.execAsync(`RELEASE ${name}`);
        return result;
      } catch (e) {
        await raw.execAsync(`ROLLBACK TO ${name}; RELEASE ${name}`);
        throw e;
      } finally {
        depth--;
      }
    },
  };
}

let opened: { raw: SQLite.SQLiteDatabase; db: Db } | null = null;

/**
 * Opens the encrypted database. SQLCipher is enabled by the expo-sqlite
 * config plugin (useSQLCipher); `PRAGMA key` must be the first statement.
 */
export async function openDatabase(): Promise<Db> {
  if (opened) return opened.db;
  const raw = await SQLite.openDatabaseAsync(DB_NAME);
  if (Platform.OS !== 'web') {
    const key = await getOrCreateDbKey();
    await raw.execAsync(`PRAGMA key = "x'${key}'"`);
  }
  await raw.execAsync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  const db = adapt(raw);
  await migrate(db);
  opened = { raw, db };
  return db;
}

/** Deletes the database file entirely (used by Wipe all local data). */
export async function deleteDatabase(): Promise<void> {
  if (opened) {
    await opened.raw.closeAsync();
    opened = null;
  }
  await SQLite.deleteDatabaseAsync(DB_NAME);
}
