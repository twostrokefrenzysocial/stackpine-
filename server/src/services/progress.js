// Weight trend, pace flags, and pass readiness.

import { db, getSettings } from '../db.js';
import { STANDARDS, readinessFor, standardFor } from '../standards.js';
import { addDays, diffDays } from '../util/date.js';
import { mondayOf } from '../plan.js';

const mondayOfSafe = mondayOf;

export function weighIns(limit = 400) {
  return db.prepare('SELECT date, lbs FROM weigh_ins ORDER BY date ASC LIMIT ?').all(limit);
}

export function latestWeight() {
  return db.prepare('SELECT date, lbs FROM weigh_ins ORDER BY date DESC LIMIT 1').get() || null;
}

// Pounds per week lost over the trailing 7 days. Positive means losing.
export function sevenDayTrend(todayISO) {
  const from = addDays(todayISO, -6);
  const rows = db
    .prepare('SELECT date, lbs FROM weigh_ins WHERE date BETWEEN ? AND ? ORDER BY date ASC')
    .all(from, todayISO);
  if (rows.length < 2) return null;
  const first = rows[0];
  const last = rows[rows.length - 1];
  const days = diffDays(first.date, last.date);
  if (days < 3) return null;
  const rate = ((first.lbs - last.lbs) / days) * 7;
  return {
    lbs_per_week: Number(rate.toFixed(2)),
    from: first.date,
    to: last.date,
    days,
    samples: rows.length,
  };
}

// Weekly averages, newest last. Used for the "too slow for 3 weeks" flag.
export function weeklyAverages(todayISO, weeks = 8) {
  const from = addDays(mondayOfSafe(todayISO), -7 * (weeks - 1));
  const rows = db
    .prepare('SELECT date, lbs FROM weigh_ins WHERE date >= ? ORDER BY date ASC')
    .all(from);
  const buckets = new Map();
  for (const row of rows) {
    const key = mondayOfSafe(row.date);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(row.lbs);
  }
  return [...buckets.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([week_start, values]) => ({
      week_start,
      avg_lbs: Number((values.reduce((s, v) => s + v, 0) / values.length).toFixed(2)),
      samples: values.length,
    }));
}

export function paceFlags(todayISO) {
  const flags = [];
  const trend = sevenDayTrend(todayISO);

  if (trend && trend.lbs_per_week > 2.5) {
    flags.push({
      level: 'warn',
      key: 'too_fast',
      title: 'Losing faster than 2.5 lbs per week',
      body: `Your 7 day trend is ${trend.lbs_per_week} lbs per week. That is above the 1.5 to 2.0 target. Push protein and total food up, and bring this to your prescriber.`,
    });
  }

  const averages = weeklyAverages(todayISO, 6);
  if (averages.length >= 4) {
    const recent = averages.slice(-4);
    const rates = [];
    for (let i = 1; i < recent.length; i += 1) {
      rates.push(recent[i - 1].avg_lbs - recent[i].avg_lbs);
    }
    if (rates.length >= 3 && rates.every((r) => r < 1)) {
      flags.push({
        level: 'info',
        key: 'too_slow',
        title: 'Under 1 lb per week for 3 weeks',
        body: 'Weekly averages have moved less than 1 lb for three weeks running. Time to look at intake, hydration, and step count, and check in with your prescriber.',
      });
    }
  }

  if (trend && trend.lbs_per_week >= 1.5 && trend.lbs_per_week <= 2.0) {
    flags.push({
      level: 'good',
      key: 'on_pace',
      title: 'On pace',
      body: `7 day trend is ${trend.lbs_per_week} lbs per week, right in the 1.5 to 2.0 window.`,
    });
  }

  return flags;
}

export function testHistory(type) {
  return db
    .prepare('SELECT id, date, value, notes FROM test_results WHERE type = ? ORDER BY date ASC')
    .all(type);
}

export function latestTest(type) {
  return (
    db
      .prepare('SELECT id, date, value, notes FROM test_results WHERE type = ? ORDER BY date DESC LIMIT 1')
      .get(type) || null
  );
}

export function readinessCard() {
  return STANDARDS.events.map((event) => {
    const latest = latestTest(event.key);
    const status = latest ? readinessFor(event.key, latest.value) : 'unknown';
    let gap = null;
    if (latest) {
      gap = event.higherIsBetter ? event.entry - latest.value : latest.value - event.entry;
      gap = Number(gap.toFixed(1));
    }
    return {
      key: event.key,
      name: event.name,
      unit: event.unit,
      entry: event.entry,
      exit: event.exit,
      higher_is_better: event.higherIsBetter,
      latest: latest ? latest.value : null,
      latest_date: latest ? latest.date : null,
      status,
      gap_to_entry: gap === null ? null : Math.max(0, gap),
    };
  });
}

export function weightSummary(todayISO) {
  const settings = getSettings();
  const latest = latestWeight();
  const current = latest ? latest.lbs : settings.start_weight;
  const lost = Number((settings.start_weight - current).toFixed(1));
  const goal = Number((settings.start_weight - settings.goal_weight).toFixed(1));
  const remaining = Number((current - settings.goal_weight).toFixed(1));
  return {
    start_weight: settings.start_weight,
    start_date: settings.start_date,
    goal_weight: settings.goal_weight,
    current_weight: current,
    latest_date: latest ? latest.date : null,
    lost,
    goal_total: goal,
    remaining,
    percent: goal > 0 ? Math.max(0, Math.min(100, Math.round((lost / goal) * 100))) : 0,
    trend: sevenDayTrend(todayISO),
  };
}

export function guideBand(startWeight, startDate, endDate) {
  // Shaded band showing where weight would sit at 1.5 and 2.0 lbs per week.
  const out = [];
  let cursor = startDate;
  while (cursor <= endDate) {
    const weeks = diffDays(startDate, cursor) / 7;
    out.push({
      date: cursor,
      slow: Number((startWeight - 1.5 * weeks).toFixed(1)),
      fast: Number((startWeight - 2.0 * weeks).toFixed(1)),
    });
    cursor = addDays(cursor, 7);
  }
  return out;
}

export { standardFor };
