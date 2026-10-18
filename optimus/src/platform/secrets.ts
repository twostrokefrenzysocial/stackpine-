import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

/**
 * Secrets live in expo-secure-store, which on Android is backed by the
 * Android Keystore. Web (preview only) falls back to memory.
 */
const memory = new Map<string, string>();
const web = Platform.OS === 'web';

async function get(key: string): Promise<string | null> {
  if (web) return memory.get(key) ?? null;
  return SecureStore.getItemAsync(key);
}

async function set(key: string, value: string): Promise<void> {
  if (web) {
    memory.set(key, value);
    return;
  }
  await SecureStore.setItemAsync(key, value, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
}

async function remove(key: string): Promise<void> {
  if (web) {
    memory.delete(key);
    return;
  }
  await SecureStore.deleteItemAsync(key);
}

const DB_KEY = 'optimus.db.key';
const PROXY_TOKEN = 'optimus.proxy.token';
const OAUTH_PREFIX = 'optimus.oauth.';

/** 256-bit random SQLCipher key, created on first launch. */
export async function getOrCreateDbKey(): Promise<string> {
  const existing = await get(DB_KEY);
  if (existing) return existing;
  const bytes = await Crypto.getRandomBytesAsync(32);
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  await set(DB_KEY, hex);
  return hex;
}

export const proxyToken = {
  get: () => get(PROXY_TOKEN),
  set: (v: string) => (v ? set(PROXY_TOKEN, v.trim()) : remove(PROXY_TOKEN)),
};

export const oauthTokens = {
  get: async <T,>(provider: string): Promise<T | null> => {
    const raw = await get(OAUTH_PREFIX + provider);
    return raw ? (JSON.parse(raw) as T) : null;
  },
  set: (provider: string, value: unknown) => set(OAUTH_PREFIX + provider, JSON.stringify(value)),
  remove: (provider: string) => remove(OAUTH_PREFIX + provider),
};

/** Used by "Wipe all local data". The DB key goes too, so the file is unreadable. */
export async function wipeSecrets(): Promise<void> {
  await Promise.all([remove(DB_KEY), remove(PROXY_TOKEN), remove(OAUTH_PREFIX + 'gmail'), remove(OAUTH_PREFIX + 'outlook')]);
}
