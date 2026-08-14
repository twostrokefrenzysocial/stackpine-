// Creates the settings row (seeded with Chris's starting numbers), sets the
// initial PIN, and writes the first 16 weeks of the schedule.
//
// Safe to run more than once: it never overwrites existing settings and never
// duplicates a scheduled block.

import 'dotenv/config';
import { db, getSettings } from './db.js';
import { hashPin } from './auth.js';
import { generateWeeks, ensurePlanThrough, refreshFutureBlocks } from './planStore.js';
import { PLAN_START } from './plan.js';
import { localDate } from './util/date.js';

export function seed({ quiet = false } = {}) {
  const log = quiet ? () => {} : (...args) => console.log(...args);

  let settings = getSettings();
  if (!settings) {
    db.prepare(
      `INSERT INTO settings (id, name, age, sex, start_date, start_weight, goal_weight)
       VALUES (1, 'Chris', 33, 'male', @start, 268, 200)`
    ).run({ start: PLAN_START });
    log('Created settings with the starting profile: 268 lbs on 2026-08-14, goal 200 lbs.');
    settings = getSettings();
  }

  if (!settings.pin_hash) {
    const pin = String(process.env.INITIAL_PIN || '2468');
    db.prepare('UPDATE settings SET pin_hash = ? WHERE id = 1').run(hashPin(pin));
    log(`Set the initial PIN to ${pin}. Change it from the Settings screen after first login.`);
    settings = getSettings();
  }

  const existing = db.prepare('SELECT COUNT(*) AS n FROM workouts').get().n;
  if (existing === 0) {
    generateWeeks(1, 16);
    const count = db.prepare('SELECT COUNT(*) AS n FROM workouts').get().n;
    log(`Seeded ${count} scheduled blocks across weeks 1 to 16, starting ${PLAN_START}.`);
  } else {
    log(`Schedule already has ${existing} blocks. Leaving it alone.`);
  }

  const today = localDate(settings.timezone);
  ensurePlanThrough(today, 6);

  // Scheduled blocks are derived from settings, so a settings change or a plan
  // change in the code should reach days that have not happened yet. Completed
  // and already logged days are left exactly as they were.
  // Always reported, even in quiet mode: this rewrites the schedule, so it
  // belongs in the deploy log.
  const refreshed = refreshFutureBlocks(today);
  if (refreshed > 0) {
    console.log(`Re-synced ${refreshed} upcoming sessions with the current settings.`);
  }

  return getSettings();
}

const isDirectRun =
  process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('/src/seed.js');

if (isDirectRun) {
  seed();
  console.log('Seed complete.');
}
