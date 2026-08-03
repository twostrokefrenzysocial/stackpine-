'use strict';

// Nightly database backups. The whole budget lives in one SQLite file, so a
// copy of that file IS a full backup. Snapshots are written with SQLite's
// online backup API (safe while the app is running) into a backups/ folder
// next to the database, and pruned so they never grow without bound.

const fs = require('fs');
const path = require('path');

const KEEP_DAILY = 14; // two weeks of nightly snapshots
const KEEP_MONTHLY = 12; // plus the first snapshot of each month, a year back

function backupDir(db) {
  return path.join(path.dirname(db.name), 'backups');
}

function isRealFile(db) {
  return Boolean(db.name) && db.name !== ':memory:';
}

/** All snapshots, newest first. */
function listBackups(db) {
  const dir = backupDir(db);
  if (!isRealFile(db) || !fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => /^budget-\d{4}-\d{2}-\d{2}\.db$/.test(f))
    .sort()
    .reverse()
    .map((f) => {
      const stat = fs.statSync(path.join(dir, f));
      return { file: f, date: f.slice(7, 17), size: stat.size };
    });
}

/**
 * Keep the newest KEEP_DAILY snapshots, plus one per month (the earliest
 * snapshot of that month) for the last KEEP_MONTHLY months. Delete the rest.
 */
function prune(db) {
  const all = listBackups(db); // newest first
  const dir = backupDir(db);
  const keep = new Set(all.slice(0, KEEP_DAILY).map((b) => b.file));

  const byMonth = new Map();
  for (const b of all) {
    const month = b.date.slice(0, 7);
    byMonth.set(month, b.file); // newest-first iteration -> ends on the earliest
  }
  for (const file of Array.from(byMonth.values()).slice(0, KEEP_MONTHLY)) keep.add(file);

  for (const b of all) {
    if (!keep.has(b.file)) fs.unlinkSync(path.join(dir, b.file));
  }
}

/**
 * Write budget-<stamp>.db (idempotent per day: an existing snapshot for the
 * stamp is left alone). Returns the snapshot path, or null when the database
 * is not file-backed (tests on :memory:).
 */
async function runBackup(db, stamp) {
  if (!isRealFile(db)) return null;
  const dir = backupDir(db);
  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, `budget-${stamp}.db`);
  if (fs.existsSync(dest)) return dest;

  const tmp = dest + '.tmp';
  await db.backup(tmp);
  fs.renameSync(tmp, dest);
  prune(db);
  return dest;
}

/** A fresh snapshot for downloading; caller removes it when done. */
async function snapshotForDownload(db, stamp) {
  if (!isRealFile(db)) return null;
  const dir = backupDir(db);
  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, `download-${process.pid}-${Date.now()}.db`);
  await db.backup(dest);
  return dest;
}

module.exports = { runBackup, listBackups, snapshotForDownload, backupDir, KEEP_DAILY };
