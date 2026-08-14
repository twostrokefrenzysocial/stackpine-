// Writes generated plan blocks into the database and keeps the schedule
// stretched far enough ahead of today.

import { db, getSettings } from './db.js';
import {
  blocksForDate,
  datesForWeek,
  weekNumberFor,
  weekStartFor,
  weekEndFor,
} from './plan.js';

const insertWorkout = db.prepare(`
  INSERT INTO workouts
    (date, week_number, phase, day_of_week, block, title, summary, details,
     is_test_day, is_time_trial, sort_order)
  VALUES
    (@date, @week_number, @phase, @day_of_week, @block, @title, @summary, @details,
     @is_test_day, @is_time_trial, @sort_order)
  ON CONFLICT (date, block) DO NOTHING
`);

// Generates weeks [from, to] without disturbing anything already logged.
export function generateWeeks(fromWeek, toWeek) {
  const settings = getSettings();
  const opts = {
    inclineKey: settings?.pushup_incline || 'counter',
    phaseOverride: settings?.phase_override || null,
  };

  const run = db.transaction(() => {
    for (let w = fromWeek; w <= toWeek; w += 1) {
      for (const date of datesForWeek(w)) {
        for (const block of blocksForDate(date, { ...opts, weekNumber: w })) {
          insertWorkout.run(block);
        }
      }
    }
  });
  run();
}

// Makes sure the schedule exists from week 1 through `weeksAhead` weeks past today.
export function ensurePlanThrough(todayISO, weeksAhead = 4) {
  const currentWeek = Math.max(1, weekNumberFor(todayISO));
  const target = currentWeek + weeksAhead;
  const row = db.prepare('SELECT MAX(week_number) AS maxWeek FROM workouts').get();
  const have = row?.maxWeek || 0;
  if (have >= target) return have;
  generateWeeks(Math.max(1, have + 1), target);
  return target;
}

// Rewrites the prescription text for future, unlogged days. Used when the
// incline level advances or the phase is overridden so upcoming days reflect it.
export function refreshFutureBlocks(fromDateISO) {
  const settings = getSettings();
  const opts = {
    inclineKey: settings?.pushup_incline || 'counter',
    phaseOverride: settings?.phase_override || null,
  };

  const rows = db
    .prepare(
      `SELECT id, date, block FROM workouts
       WHERE date >= ? AND completed = 0
         AND id NOT IN (SELECT COALESCE(workout_id, -1) FROM workout_logs)`
    )
    .all(fromDateISO);

  const update = db.prepare(`
    UPDATE workouts
       SET phase = @phase, title = @title, summary = @summary, details = @details,
           is_test_day = @is_test_day, is_time_trial = @is_time_trial
     WHERE id = @id
  `);

  const run = db.transaction(() => {
    for (const row of rows) {
      const rebuilt = blocksForDate(row.date, opts).find((b) => b.block === row.block);
      if (!rebuilt) continue;
      update.run({ ...rebuilt, id: row.id });
    }
  });
  run();
  return rows.length;
}

export function workoutsForDate(dateISO) {
  return db
    .prepare('SELECT * FROM workouts WHERE date = ? ORDER BY sort_order ASC')
    .all(dateISO)
    .map(hydrate);
}

export function workoutsBetween(fromISO, toISO) {
  return db
    .prepare('SELECT * FROM workouts WHERE date BETWEEN ? AND ? ORDER BY date ASC, sort_order ASC')
    .all(fromISO, toISO)
    .map(hydrate);
}

export function workoutsForWeek(weekNumber) {
  return workoutsBetween(weekStartFor(weekNumber), weekEndFor(weekNumber));
}

export function hydrate(row) {
  if (!row) return row;
  let details = {};
  try {
    details = JSON.parse(row.details || '{}');
  } catch {
    details = {};
  }
  return { ...row, details };
}

// Swaps every block between two dates. Used by the "move a day" control.
export function swapDays(dateA, dateB) {
  if (dateA === dateB) return false;
  const temp = '9999-12-31';
  const run = db.transaction(() => {
    db.prepare('UPDATE workouts SET date = ? WHERE date = ?').run(temp, dateA);
    db.prepare('UPDATE workouts SET date = ? WHERE date = ?').run(dateA, dateB);
    db.prepare('UPDATE workouts SET date = ? WHERE date = ?').run(dateB, temp);

    // Day of week and week number follow the new dates.
    for (const d of [dateA, dateB]) {
      const wk = weekNumberFor(d);
      const dow = new Date(`${d}T00:00:00Z`).getUTCDay();
      db.prepare('UPDATE workouts SET day_of_week = ?, week_number = ? WHERE date = ?').run(
        dow,
        wk,
        d
      );
    }
  });
  run();
  return true;
}
