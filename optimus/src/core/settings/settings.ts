import type { Db } from '../db/types';
import { parseJson } from '../util/json';

export interface Settings {
  dataMode: 'mock' | 'real';
  proxyUrl: string;
  // proxyToken lives in secure storage, not here.
  theme: 'dark' | 'light' | 'system';
  voiceReplies: boolean;
  voiceRate: number;
  voicePitch: number;
  hapticsEnabled: boolean;
  soundEnabled: boolean;
  appLockEnabled: boolean;
  briefTime: string; // "07:00"
  briefEnabled: boolean;
  notificationRetentionDays: number;
  excludedNotificationApps: string[];
  notificationCaptureEnabled: boolean;
  locationEnabled: boolean;
  spendingCapUsd: number;
  onboardingDone: boolean;
  emailAccounts: ('gmail' | 'outlook')[];
  userName?: string;
}

export const DEFAULT_SETTINGS: Settings = {
  dataMode: 'mock',
  proxyUrl: '',
  theme: 'dark',
  voiceReplies: true,
  voiceRate: 0.95,
  voicePitch: 0.8,
  hapticsEnabled: true,
  soundEnabled: false,
  appLockEnabled: true,
  briefTime: '07:00',
  briefEnabled: true,
  notificationRetentionDays: 30,
  excludedNotificationApps: [],
  notificationCaptureEnabled: true,
  locationEnabled: false,
  spendingCapUsd: 20,
  onboardingDone: false,
  emailAccounts: [],
};

const KEY = 'settings';

export async function loadSettings(db: Db): Promise<Settings> {
  const row = await db.get<{ value: string }>('SELECT value FROM kv WHERE key = ?', [KEY]);
  return { ...DEFAULT_SETTINGS, ...parseJson<Partial<Settings>>(row?.value, {}) };
}

export async function saveSettings(db: Db, patch: Partial<Settings>): Promise<Settings> {
  const next = { ...(await loadSettings(db)), ...patch };
  await db.run('INSERT INTO kv(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [
    KEY,
    JSON.stringify(next),
  ]);
  return next;
}

export async function kvGet(db: Db, key: string): Promise<string | null> {
  const row = await db.get<{ value: string }>('SELECT value FROM kv WHERE key = ?', [key]);
  return row?.value ?? null;
}

export async function kvSet(db: Db, key: string, value: string): Promise<void> {
  await db.run('INSERT INTO kv(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [
    key,
    value,
  ]);
}
