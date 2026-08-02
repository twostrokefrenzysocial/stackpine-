'use strict';

// Web push: bill reminders and month-report alerts delivered to the phones'
// lock screens. VAPID keys are generated once and kept in the database, so
// there is nothing to configure.

const webpush = require('web-push');
const { today, currentMonth, previousMonth, TZ, dueDateIn, daysUntil, toDollars, nextOccurrence } = require('./util');

function ensureVapid(db) {
  let pub = db.prepare(`SELECT value FROM meta WHERE key = 'vapid_public'`).get()?.value;
  let priv = db.prepare(`SELECT value FROM meta WHERE key = 'vapid_private'`).get()?.value;
  if (!pub || !priv) {
    const keys = webpush.generateVAPIDKeys();
    pub = keys.publicKey;
    priv = keys.privateKey;
    db.prepare(`INSERT OR REPLACE INTO meta (key, value) VALUES ('vapid_public', ?)`).run(pub);
    db.prepare(`INSERT OR REPLACE INTO meta (key, value) VALUES ('vapid_private', ?)`).run(priv);
  }
  webpush.setVapidDetails(process.env.VAPID_CONTACT || 'mailto:budget@lattimer.family', pub, priv);
  return pub;
}

/** Send a payload to every registered phone; drop subscriptions that are gone. */
async function sendToAll(db, payload) {
  const subs = db.prepare(`SELECT * FROM push_subscriptions`).all();
  const body = JSON.stringify(payload);
  let sent = 0;
  for (const sub of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: JSON.parse(sub.keys_json) },
        body,
        { TTL: 12 * 3600 }
      );
      sent++;
    } catch (err) {
      if (err.statusCode === 404 || err.statusCode === 410) {
        db.prepare(`DELETE FROM push_subscriptions WHERE endpoint = ?`).run(sub.endpoint);
      }
    }
  }
  return sent;
}

/** Unpaid bills due within two days (or overdue) in the current month. */
function computeDueDigest(db) {
  const month = currentMonth();
  const bills = db.prepare(`
    SELECT c.id, c.name, c.due_day, c.budget_cents
    FROM categories c
    WHERE c.kind = 'fixed' AND c.archived = 0 AND c.due_day IS NOT NULL
      AND (c.starts_month IS NULL OR c.starts_month <= ?)
  `).all(month);
  const paid = new Set(
    db.prepare(`SELECT DISTINCT category_id FROM transactions WHERE month = ? AND source = 'billpay'`)
      .all(month).map((r) => r.category_id)
  );

  const overdue = [];
  const dueSoon = [];
  for (const bill of bills) {
    if (paid.has(bill.id)) continue;
    const days = daysUntil(dueDateIn(month, bill.due_day));
    if (days < 0) overdue.push(bill);
    else if (days <= 2) dueSoon.push(bill);
  }
  if (!overdue.length && !dueSoon.length) return null;

  const all = overdue.concat(dueSoon);
  const total = toDollars(all.reduce((s, b) => s + b.budget_cents, 0));
  const parts = [];
  if (overdue.length) parts.push(`${overdue.length} overdue`);
  if (dueSoon.length) parts.push(`${dueSoon.length} due in the next 2 days`);
  return {
    title: `Bills: ${parts.join(', ')}`,
    body: all.map((b) => b.name).slice(0, 5).join(', ') + (all.length > 5 ? '…' : '') + ` — $${total} total`,
    tag: 'bills-due',
  };
}

/** "The month closed — here's the report" nudge, first days of a new month. */
function computeReportNudge(db) {
  const prev = previousMonth();
  const day = Number(today().slice(8, 10));
  if (day > 4) return null;
  const hadData = db.prepare(`SELECT COUNT(*) AS n FROM transactions WHERE month = ?`).get(prev).n;
  if (!hadData) return null;
  return {
    title: 'Your month report is ready',
    body: 'Open the budget to see how last month went and review suggested changes.',
    tag: 'month-report',
  };
}

/** "It's payday — log your checks" on the day a source's payday lands. */
function computePaydayNudge(db) {
  const day = today();
  const due = db.prepare(`SELECT name, next_date, cadence FROM income_sources WHERE next_date IS NOT NULL`).all()
    .filter((s) => nextOccurrence(s.next_date, s.cadence || 'biweekly', day) === day);
  if (!due.length) return null;
  return {
    title: 'Payday 💵',
    body: due.map((s) => s.name).join(' and ') + ' land' + (due.length === 1 ? 's' : '') +
      ' today — open the budget and tap Log when the money shows up.',
    tag: 'payday',
  };
}

function hourInFamilyTz() {
  return Number(new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', hour12: false }).format(new Date()));
}

/**
 * Once a day, after 9am family time: due-bill digest, plus the month-report
 * nudge at the start of a month. Sent-markers live in meta so restarts and
 * redeploys never double-send.
 */
async function tick(db) {
  if (hourInFamilyTz() < 9) return;
  const day = today();

  const lastDigest = db.prepare(`SELECT value FROM meta WHERE key = 'push_last_digest'`).get()?.value;
  if (lastDigest !== day) {
    db.prepare(`INSERT OR REPLACE INTO meta (key, value) VALUES ('push_last_digest', ?)`).run(day);
    const digest = computeDueDigest(db);
    if (digest) await sendToAll(db, digest);
    const payday = computePaydayNudge(db);
    if (payday) await sendToAll(db, payday);
  }

  const month = currentMonth();
  const lastReport = db.prepare(`SELECT value FROM meta WHERE key = 'push_last_report'`).get()?.value;
  if (lastReport !== month) {
    const nudge = computeReportNudge(db);
    if (nudge) {
      db.prepare(`INSERT OR REPLACE INTO meta (key, value) VALUES ('push_last_report', ?)`).run(month);
      await sendToAll(db, nudge);
    }
  }
}

function startScheduler(db) {
  ensureVapid(db);
  const run = () => tick(db).catch((err) => console.error('push tick failed:', err.message));
  const timer = setInterval(run, 10 * 60 * 1000);
  timer.unref();
  setTimeout(run, 15 * 1000).unref(); // first check shortly after boot
  return timer;
}

module.exports = { ensureVapid, sendToAll, computeDueDigest, computeReportNudge, computePaydayNudge, startScheduler };
