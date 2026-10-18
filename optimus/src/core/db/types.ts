export type SqlValue = string | number | null;
export type SqlParams = SqlValue[];

/**
 * Minimal async database contract. Implemented by expo-sqlite (SQLCipher) on
 * device and by better-sqlite3 in unit tests, so the same SQL runs in both.
 */
export interface Db {
  exec(sql: string): Promise<void>;
  run(sql: string, params?: SqlParams): Promise<{ changes: number; lastInsertRowId: number }>;
  all<T = Record<string, unknown>>(sql: string, params?: SqlParams): Promise<T[]>;
  get<T = Record<string, unknown>>(sql: string, params?: SqlParams): Promise<T | null>;
  transaction<T>(fn: () => Promise<T>): Promise<T>;
}
