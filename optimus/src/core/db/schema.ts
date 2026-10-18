import type { Db } from './types';

/**
 * Ordered migrations. Each entry runs once; the applied version is stored in
 * PRAGMA user_version. Never edit a shipped migration; append a new one.
 */
export const MIGRATIONS: string[] = [
  // 1: core tables
  `
  CREATE TABLE IF NOT EXISTS kv (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    rolling_summary TEXT,
    summarized_through TEXT,
    processed_at TEXT
  );

  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    seq INTEGER NOT NULL,
    role TEXT NOT NULL,
    text TEXT NOT NULL,
    cards TEXT NOT NULL DEFAULT '[]',
    api_content TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS messages_conv ON messages(conversation_id, seq);

  CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
    text, conversation_id UNINDEXED, message_id UNINDEXED, tokenize = 'porter unicode61'
  );

  CREATE TABLE IF NOT EXISTS memories (
    id TEXT PRIMARY KEY,
    category TEXT NOT NULL,
    content TEXT NOT NULL,
    source TEXT NOT NULL,
    source_ref TEXT,
    contact_id TEXT,
    person_name TEXT,
    aliases TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    last_used_at TEXT,
    importance INTEGER NOT NULL DEFAULT 3,
    previous_value TEXT,
    sensitive INTEGER NOT NULL DEFAULT 0,
    derived_from TEXT NOT NULL DEFAULT '[]'
  );
  CREATE INDEX IF NOT EXISTS memories_category ON memories(category);
  CREATE UNIQUE INDEX IF NOT EXISTS memories_contact ON memories(contact_id) WHERE contact_id IS NOT NULL;

  CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
    content, person_name, aliases, memory_id UNINDEXED, tokenize = 'porter unicode61'
  );

  CREATE TABLE IF NOT EXISTS pending_memories (
    id TEXT PRIMARY KEY,
    category TEXT NOT NULL,
    content TEXT NOT NULL,
    source TEXT NOT NULL,
    source_ref TEXT,
    reason TEXT NOT NULL,
    person_name TEXT,
    contact_id TEXT,
    importance INTEGER NOT NULL DEFAULT 3,
    created_at TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending'
  );

  CREATE TABLE IF NOT EXISTS episodes (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    summary TEXT NOT NULL,
    decisions TEXT NOT NULL DEFAULT '[]',
    open_tasks TEXT NOT NULL DEFAULT '[]',
    topics TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL
  );
  CREATE VIRTUAL TABLE IF NOT EXISTS episodes_fts USING fts5(
    summary, topics, episode_id UNINDEXED, tokenize = 'porter unicode61'
  );

  CREATE TABLE IF NOT EXISTS actions (
    id TEXT PRIMARY KEY,
    conversation_id TEXT,
    kind TEXT NOT NULL,
    title TEXT NOT NULL,
    draft TEXT NOT NULL,
    editable TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL,
    created_at TEXT NOT NULL,
    resolved_at TEXT,
    result_message TEXT
  );

  CREATE TABLE IF NOT EXISTS activity (
    id TEXT PRIMARY KEY,
    at TEXT NOT NULL,
    kind TEXT NOT NULL,
    tool TEXT,
    summary TEXT NOT NULL,
    detail TEXT
  );
  CREATE INDEX IF NOT EXISTS activity_at ON activity(at);

  CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY,
    package_name TEXT NOT NULL,
    app_name TEXT NOT NULL,
    title TEXT NOT NULL,
    text TEXT NOT NULL,
    posted_at TEXT NOT NULL,
    category TEXT,
    redacted INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS notifications_posted ON notifications(posted_at);

  CREATE TABLE IF NOT EXISTS reminders (
    id TEXT PRIMARY KEY,
    text TEXT NOT NULL,
    due_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    notification_id TEXT,
    done INTEGER NOT NULL DEFAULT 0,
    conversation_id TEXT
  );

  CREATE TABLE IF NOT EXISTS briefs (
    id TEXT PRIMARY KEY,
    date TEXT NOT NULL UNIQUE,
    generated_at TEXT NOT NULL,
    data TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sync_state (
    source TEXT PRIMARY KEY,
    cursor TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  `,
  // v-next: daily routines and their pre-written, scheduled notifications.
  `
  CREATE TABLE IF NOT EXISTS routines (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    instruction TEXT NOT NULL,
    time TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS routine_items (
    id TEXT PRIMARY KEY,
    routine_id TEXT NOT NULL,
    date TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    notification_id TEXT
  );
  CREATE UNIQUE INDEX IF NOT EXISTS routine_items_day ON routine_items(routine_id, date);
  `,
];

/** True when SQLite was built with FTS5 (the Android build is; the browser preview isn't). */
export async function hasFts5(db: Db): Promise<boolean> {
  try {
    await db.exec('CREATE VIRTUAL TABLE IF NOT EXISTS temp.__fts5_probe USING fts5(a); DROP TABLE temp.__fts5_probe;');
    return true;
  } catch {
    return false;
  }
}

/** Rewrites FTS5 tables as plain tables so the app still runs without FTS5. */
export function withoutFts5(sql: string): string {
  return sql.replace(/CREATE VIRTUAL TABLE IF NOT EXISTS (\w+) USING fts5\(([\s\S]*?)\);/g, (_m, name: string, cols: string) => {
    const columns = cols
      .split(',')
      .map((c) => c.trim())
      .filter((c) => c && !c.startsWith('tokenize'))
      .map((c) => `${c.replace(/\s+UNINDEXED$/, '')} TEXT`);
    return `CREATE TABLE IF NOT EXISTS ${name} (${columns.join(', ')});`;
  });
}

export async function migrate(db: Db): Promise<number> {
  const row = await db.get<{ user_version: number }>('PRAGMA user_version');
  let version = row?.user_version ?? 0;
  const fts = version < MIGRATIONS.length ? await hasFts5(db) : true;
  while (version < MIGRATIONS.length) {
    const sql = fts ? MIGRATIONS[version] : withoutFts5(MIGRATIONS[version]);
    await db.transaction(async () => {
      await db.exec(sql);
    });
    version += 1;
    // PRAGMA doesn't accept bound parameters; version is our own integer.
    await db.exec(`PRAGMA user_version = ${version}`);
  }
  return version;
}
