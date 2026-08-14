// Web push delivery. Notification copy is deliberately plain: no emoji.

import webpush from 'web-push';
import { db } from '../db.js';

let configured = false;

export function configurePush() {
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || 'mailto:admin@example.com';
  if (!pub || !priv) {
    configured = false;
    return false;
  }
  webpush.setVapidDetails(subject, pub, priv);
  configured = true;
  return true;
}

export function pushReady() {
  return configured;
}

export function publicKey() {
  return process.env.VAPID_PUBLIC_KEY || null;
}

export function saveSubscription(sub, label = null) {
  if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) {
    throw new Error('That subscription is missing its endpoint or keys.');
  }
  db.prepare(
    `INSERT INTO push_subscriptions (endpoint, p256dh, auth, label)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth`
  ).run(sub.endpoint, sub.keys.p256dh, sub.keys.auth, label);
  return true;
}

export function removeSubscription(endpoint) {
  db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(endpoint);
}

export function listSubscriptions() {
  return db
    .prepare('SELECT id, endpoint, label, created_at FROM push_subscriptions ORDER BY id ASC')
    .all();
}

export async function sendToAll(payload) {
  if (!configured) return { sent: 0, removed: 0, skipped: 'Push is not configured on the server.' };
  const subs = db.prepare('SELECT * FROM push_subscriptions').all();
  let sent = 0;
  let removed = 0;

  for (const row of subs) {
    const subscription = {
      endpoint: row.endpoint,
      keys: { p256dh: row.p256dh, auth: row.auth },
    };
    try {
      await webpush.sendNotification(subscription, JSON.stringify(payload));
      sent += 1;
    } catch (err) {
      // 404 and 410 mean the browser dropped the subscription for good.
      if (err.statusCode === 404 || err.statusCode === 410) {
        removeSubscription(row.endpoint);
        removed += 1;
      } else {
        console.error('Push send failed:', err.statusCode, err.body || err.message);
      }
    }
  }

  return { sent, removed, total: subs.length };
}

export function alreadySent(kind, date) {
  return Boolean(
    db.prepare('SELECT 1 FROM notification_log WHERE kind = ? AND date = ?').get(kind, date)
  );
}

export function markSent(kind, date, detail = null) {
  db.prepare(
    'INSERT OR IGNORE INTO notification_log (kind, date, detail) VALUES (?, ?, ?)'
  ).run(kind, date, detail);
}
