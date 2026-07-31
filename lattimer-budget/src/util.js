'use strict';

const crypto = require('crypto');

const PEOPLE = ['Chris', 'Miriam'];
const TZ = process.env.TZ_NAME || process.env.TZ || 'America/New_York';

// ---------- dates (always in the family's local timezone, not the server's) ----------

const dateFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Today as YYYY-MM-DD in the configured timezone. */
function today() {
  return dateFmt.format(new Date());
}

/** Current month as YYYY-MM. */
function currentMonth() {
  return today().slice(0, 7);
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_RE = /^\d{4}-\d{2}$/;

function isValidDate(value) {
  if (typeof value !== 'string' || !DATE_RE.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const probe = new Date(Date.UTC(y, m - 1, d));
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d;
}

function isValidMonth(value) {
  if (typeof value !== 'string' || !MONTH_RE.test(value)) return false;
  const m = Number(value.slice(5, 7));
  return m >= 1 && m <= 12;
}

function shiftMonth(month, delta) {
  const y = Number(month.slice(0, 4));
  let m = Number(month.slice(5, 7)) - 1 + delta;
  const year = y + Math.floor(m / 12);
  m = ((m % 12) + 12) % 12;
  return `${year}-${String(m + 1).padStart(2, '0')}`;
}

function previousMonth() {
  return shiftMonth(currentMonth(), -1);
}

/**
 * Days into a new month during which last month can still be edited, so a
 * purchase made on the 31st can be entered on the 1st. Read per call so it
 * can be changed without a restart in tests.
 */
function graceDays() {
  const raw = Number(process.env.BACKDATE_GRACE_DAYS);
  if (!Number.isFinite(raw)) return 5;
  // 0 closes last month the moment the new one starts; 31 keeps it open all month.
  return Math.max(0, Math.min(31, Math.floor(raw)));
}

/** True through the end of the grace day itself, e.g. all of the 5th when days = 5. */
function inGraceWindow() {
  return Number(today().slice(8, 10)) <= graceDays();
}

/** Can this month still be written to? */
function isWritableMonth(month) {
  if (month === currentMonth()) return true;
  return month === previousMonth() && inGraceWindow();
}

/** Oldest date a new transaction may carry right now (for the date picker). */
function earliestWritableDate() {
  return inGraceWindow() ? `${previousMonth()}-01` : `${currentMonth()}-01`;
}

/** Last calendar day of a YYYY-MM month. */
function lastDayOfMonth(month) {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  const day = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${month}-${String(day).padStart(2, '0')}`;
}

// ---------- money ----------

/** Accepts 12.34 or "12.34" and returns integer cents. Returns null when unusable. */
function toCents(value) {
  const n = typeof value === 'string' ? Number(value.trim()) : value;
  if (typeof n !== 'number' || !Number.isFinite(n)) return null;
  const cents = Math.round(n * 100);
  if (!Number.isSafeInteger(cents)) return null;
  return cents;
}

function toDollars(cents) {
  return Math.round(cents) / 100;
}

// ---------- auth ----------

function familyPin() {
  return String(process.env.FAMILY_PIN || '0000');
}

function sessionSecret() {
  return String(process.env.SESSION_SECRET || `lattimer:${familyPin()}`);
}

/** Stateless token so a redeploy does not sign both phones out. */
function makeToken(person) {
  const mac = crypto.createHmac('sha256', sessionSecret()).update(person).digest('base64url');
  return `${Buffer.from(person, 'utf8').toString('base64url')}.${mac}`;
}

function verifyToken(token) {
  if (typeof token !== 'string' || !token.includes('.')) return null;
  const [rawPerson, mac] = token.split('.');
  let person;
  try {
    person = Buffer.from(rawPerson, 'base64url').toString('utf8');
  } catch {
    return null;
  }
  if (!PEOPLE.includes(person)) return null;
  const expected = crypto.createHmac('sha256', sessionSecret()).update(person).digest('base64url');
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return person;
}

function pinMatches(pin) {
  const a = Buffer.from(String(pin ?? ''));
  const b = Buffer.from(familyPin());
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = {
  PEOPLE,
  TZ,
  today,
  currentMonth,
  previousMonth,
  shiftMonth,
  graceDays,
  inGraceWindow,
  isWritableMonth,
  earliestWritableDate,
  lastDayOfMonth,
  isValidDate,
  isValidMonth,
  toCents,
  toDollars,
  makeToken,
  verifyToken,
  pinMatches,
  familyPin,
};
