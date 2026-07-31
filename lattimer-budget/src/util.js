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
  isValidDate,
  isValidMonth,
  toCents,
  toDollars,
  makeToken,
  verifyToken,
  pinMatches,
  familyPin,
};
