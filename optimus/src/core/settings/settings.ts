import type { Db } from '../db/types';
import { parseJson } from '../util/json';

export interface Settings {
  dataMode: 'mock' | 'real';
  proxyUrl: string;
  /** Which AI company the proxy forwards to. Both keys live only in the proxy. */
  provider: 'anthropic' | 'openai';
  /** OpenAI model ids (must be in the proxy's OPENAI_MODELS list). */
  openaiModel: string;
  openaiBackgroundModel: string;
  /** Bumped when the recommended models change, to upgrade once. */
  modelDefaultsVersion?: number;
  // proxyToken lives in secure storage, not here.
  theme: 'light';
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
  /** Describe photos in the background so search finds anything in the library. */
  photoIndexEnabled: boolean;
  /** Let Optimus search the web for facts, news, weather, places. */
  webSearchEnabled: boolean;
  /** How long the model thinks before answering: fast replies by default. */
  thinking: 'fast' | 'balanced' | 'deep';
  /** The spoken voice's accent (British male by default). */
  voiceAccent: 'british' | 'american';
  spendingCapUsd: number;
  onboardingDone: boolean;
  emailAccounts: ('gmail' | 'outlook' | 'icloud')[];
  /** Gmail reached through the proxy with an app password (no Google Cloud setup). */
  gmailViaProxy: boolean;
  userName?: string;
}

export const DEFAULT_SETTINGS: Settings = {
  dataMode: 'mock',
  proxyUrl: '',
  provider: 'anthropic',
  openaiModel: '',
  openaiBackgroundModel: '',
  theme: 'light',
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
  photoIndexEnabled: true,
  webSearchEnabled: true,
  thinking: 'fast',
  voiceAccent: 'british',
  spendingCapUsd: 20,
  onboardingDone: false,
  emailAccounts: [],
  gmailViaProxy: false,
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

/** Recommended OpenAI models: the full model for conversation, mini for background work. */
export const RECOMMENDED_OPENAI = { main: 'gpt-5', background: 'gpt-5-mini' };
export const MODEL_DEFAULTS_VERSION = 1;

/**
 * One-time upgrade of the OpenAI model choice. Someone running the budget
 * model for chat moves to the full model, keeping the budget one for
 * background jobs. A model the user typed themselves is left alone.
 */
export function upgradeModelDefaults(s: Settings): Partial<Settings> | null {
  if ((s.modelDefaultsVersion ?? 0) >= MODEL_DEFAULTS_VERSION) return null;
  const patch: Partial<Settings> = { modelDefaultsVersion: MODEL_DEFAULTS_VERSION };
  const main = s.openaiModel.trim();
  if (!main || main === 'gpt-5-mini') {
    patch.openaiModel = RECOMMENDED_OPENAI.main;
    if (!s.openaiBackgroundModel.trim()) patch.openaiBackgroundModel = RECOMMENDED_OPENAI.background;
  }
  return patch;
}
