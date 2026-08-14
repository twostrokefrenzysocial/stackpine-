// Date helpers. All plan dates are plain YYYY-MM-DD strings handled in UTC so
// that day arithmetic never shifts across a daylight saving boundary.

export function toDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function toISO(date) {
  return date.toISOString().slice(0, 10);
}

export function addDays(iso, n) {
  const d = toDate(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return toISO(d);
}

export function diffDays(fromISO, toISOStr) {
  return Math.round((toDate(toISOStr) - toDate(fromISO)) / 86400000);
}

// 0 = Sunday ... 6 = Saturday
export function dayOfWeek(iso) {
  return toDate(iso).getUTCDay();
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function dayName(iso) {
  return DAY_NAMES[dayOfWeek(iso)];
}

export function dayShort(iso) {
  return DAY_SHORT[dayOfWeek(iso)];
}

// Current calendar date in the given IANA timezone, as YYYY-MM-DD.
export function localDate(timezone = 'America/New_York', when = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(when);
}

// Current wall clock time in the given timezone, as HH:MM (24 hour).
export function localTime(timezone = 'America/New_York', when = new Date()) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(when);
}

// Format a duration in seconds as M:SS.
export function formatSeconds(totalSeconds) {
  const s = Math.max(0, Math.round(Number(totalSeconds) || 0));
  const m = Math.floor(s / 60);
  const rest = s % 60;
  return `${m}:${String(rest).padStart(2, '0')}`;
}

// Parse "12:25" or "745" into seconds.
export function parseDuration(value) {
  if (value === null || value === undefined) return null;
  const str = String(value).trim();
  if (!str) return null;
  if (str.includes(':')) {
    const [m, s] = str.split(':');
    return Number(m) * 60 + Number(s);
  }
  return Number(str);
}
