import * as Crypto from 'expo-crypto';
import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { createBackup, restoreBackup } from '../core/backup/backup';
import type { Db } from '../core/db/types';

/**
 * Writes an encrypted backup and opens the share sheet so it can be saved
 * to Google Drive, Samsung Cloud or anywhere else.
 */
export async function exportBackup(db: Db, passphrase: string): Promise<void> {
  const text = await createBackup(db, passphrase, (n) => Crypto.getRandomBytes(n));
  const stamp = new Date().toISOString().slice(0, 10);
  const file = new File(Paths.cache, `optimus-backup-${stamp}.optimus`);
  if (file.exists) file.delete();
  file.create();
  await file.write(text);
  if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing isn’t available on this device.');
  await Sharing.shareAsync(file.uri, { mimeType: 'application/octet-stream', dialogTitle: 'Save Optimus backup' });
}

/** Picks a backup file and restores it (replaces local memories and conversations). */
export async function importBackup(db: Db, passphrase: string): Promise<{ memories: number; conversations: number } | null> {
  const pick = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true, multiple: false });
  if (pick.canceled || !pick.assets?.[0]) return null;
  const text = await new File(pick.assets[0].uri).text();
  return restoreBackup(db, text, passphrase);
}
