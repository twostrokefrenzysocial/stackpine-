export function formatSeconds(total) {
  const s = Math.max(0, Math.round(Number(total) || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function parseDuration(value) {
  const str = String(value ?? '').trim();
  if (!str) return null;
  if (str.includes(':')) {
    const [m, s] = str.split(':');
    const mins = Number(m);
    const secs = Number(s);
    if (!Number.isFinite(mins) || !Number.isFinite(secs)) return null;
    return mins * 60 + secs;
  }
  const n = Number(str);
  return Number.isFinite(n) ? n : null;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function shortDate(iso) {
  if (!iso) return '';
  const [, m, d] = iso.split('-').map(Number);
  return `${MONTHS[m - 1]} ${d}`;
}

export function longDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

export function addDays(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}

export function todayISO() {
  return new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

export const SLOT_LABELS = {
  breakfast: 'Breakfast',
  snack1: 'Morning snack',
  lunch: 'Lunch',
  snack2: 'Afternoon snack',
  dinner: 'Dinner',
};

export const BLOCK_LABELS = {
  run: 'Run',
  pushups_situps: 'Push-ups and sit-ups',
  strength: 'Strength',
  rest: 'Rest',
};

export function statusColor(status) {
  if (status === 'green') return 'var(--status-good)';
  if (status === 'yellow') return 'var(--status-warning)';
  if (status === 'red') return 'var(--status-critical)';
  return 'var(--text-muted)';
}

export function statusWord(status) {
  if (status === 'green') return 'At exit standard';
  if (status === 'yellow') return 'Passing entry';
  if (status === 'red') return 'Below entry';
  return 'No test yet';
}
