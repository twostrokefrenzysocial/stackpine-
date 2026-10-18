import { gcm } from '@noble/ciphers/aes.js';
import { pbkdf2Async } from '@noble/hashes/pbkdf2.js';
import { sha256 } from '@noble/hashes/sha2.js';
import type { Db } from '../db/types';

/**
 * Encrypted backup of everything Optimus remembers: memories (and pending
 * suggestions), conversations, episodes, reminders, activity and settings.
 * Secrets (API token, OAuth tokens, database key) are never included.
 *
 * Format: JSON envelope with PBKDF2-SHA256 key derivation and AES-256-GCM.
 */

export const BACKUP_TABLES = ['memories', 'pending_memories', 'conversations', 'messages', 'episodes', 'reminders', 'activity', 'briefs', 'kv'] as const;
const FTS_REBUILD: Record<string, string> = {
  memories: "INSERT INTO memories_fts(content, person_name, aliases, memory_id) SELECT content, COALESCE(person_name, ''), aliases, id FROM memories",
  messages: "INSERT INTO messages_fts(text, conversation_id, message_id) SELECT text, conversation_id, id FROM messages WHERE TRIM(text) != ''",
  episodes: "INSERT INTO episodes_fts(summary, topics, episode_id) SELECT summary || ' ' || open_tasks || ' ' || decisions, topics, id FROM episodes",
};
const FTS_TABLE: Record<string, string> = { memories: 'memories_fts', messages: 'messages_fts', episodes: 'episodes_fts' };

export const PBKDF2_ITERATIONS = 150_000;

export interface BackupEnvelope {
  format: 'optimus-backup';
  version: 1;
  createdAt: string;
  kdf: { alg: 'pbkdf2-sha256'; iterations: number; salt: string };
  cipher: 'aes-256-gcm';
  nonce: string;
  data: string;
}

type Rows = Record<string, Record<string, unknown>[]>;

const toB64 = (u: Uint8Array) => {
  let s = '';
  for (const b of u) s += String.fromCharCode(b);
  return btoa(s);
};
const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const utf8 = (s: string) => Uint8Array.from(unescape(encodeURIComponent(s)), (c) => c.charCodeAt(0));
const fromUtf8 = (u: Uint8Array) => {
  let s = '';
  for (const b of u) s += String.fromCharCode(b);
  return decodeURIComponent(escape(s));
};

async function deriveKey(passphrase: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  return pbkdf2Async(sha256, utf8(passphrase.normalize('NFKC')), salt, { c: iterations, dkLen: 32 });
}

export class BackupError extends Error {}

export async function createBackup(db: Db, passphrase: string, random: (n: number) => Uint8Array, now = new Date()): Promise<string> {
  if (passphrase.length < 8) throw new BackupError('Use a passphrase of at least 8 characters.');
  const rows: Rows = {};
  for (const t of BACKUP_TABLES) {
    rows[t] = await db.all<Record<string, unknown>>(`SELECT * FROM ${t}`);
  }
  const salt = random(16);
  const nonce = random(12);
  const key = await deriveKey(passphrase, salt, PBKDF2_ITERATIONS);
  const plaintext = utf8(JSON.stringify({ tables: rows }));
  const sealed = gcm(key, nonce).encrypt(plaintext);
  const env: BackupEnvelope = {
    format: 'optimus-backup',
    version: 1,
    createdAt: now.toISOString(),
    kdf: { alg: 'pbkdf2-sha256', iterations: PBKDF2_ITERATIONS, salt: toB64(salt) },
    cipher: 'aes-256-gcm',
    nonce: toB64(nonce),
    data: toB64(sealed),
  };
  return JSON.stringify(env);
}

export async function readBackup(file: string, passphrase: string): Promise<Rows> {
  let env: BackupEnvelope;
  try {
    env = JSON.parse(file);
  } catch {
    throw new BackupError('That file isn’t an Optimus backup.');
  }
  if (env.format !== 'optimus-backup' || env.version !== 1) throw new BackupError('That file isn’t an Optimus backup.');
  const key = await deriveKey(passphrase, fromB64(env.kdf.salt), env.kdf.iterations);
  let plain: Uint8Array;
  try {
    plain = gcm(key, fromB64(env.nonce)).decrypt(fromB64(env.data));
  } catch {
    throw new BackupError('Wrong passphrase, or the file is damaged.');
  }
  return (JSON.parse(fromUtf8(plain)) as { tables: Rows }).tables;
}

/** Replaces local data with the backup's contents, then rebuilds search indexes. */
export async function restoreBackup(db: Db, file: string, passphrase: string): Promise<{ memories: number; conversations: number }> {
  const tables = await readBackup(file, passphrase);
  await db.transaction(async () => {
    for (const t of BACKUP_TABLES) {
      await db.run(`DELETE FROM ${t}`);
      if (FTS_TABLE[t]) await db.run(`DELETE FROM ${FTS_TABLE[t]}`);
      for (const row of tables[t] ?? []) {
        const cols = Object.keys(row).filter((c) => /^[a-z_]+$/.test(c));
        if (!cols.length) continue;
        await db.run(`INSERT INTO ${t}(${cols.join(',')}) VALUES(${cols.map(() => '?').join(',')})`, cols.map((c) => row[c] as string | number | null));
      }
      if (FTS_REBUILD[t]) await db.run(FTS_REBUILD[t]);
    }
  });
  return { memories: tables.memories?.length ?? 0, conversations: tables.conversations?.length ?? 0 };
}
