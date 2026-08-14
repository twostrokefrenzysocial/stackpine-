// node-cron scheduler. Runs once a minute in the user's timezone, compares the
// wall clock against the times saved in settings, and sends anything due.
// notification_log keeps each item to one send per day.

import cron from 'node-cron';
import { db, getSettings } from '../db.js';
import { localDate, localTime, addDays, dayOfWeek } from '../util/date.js';
import { workoutsForDate, ensurePlanThrough } from '../planStore.js';
import { weekNumberFor, isTimeTrialWeek, mondayOf } from '../plan.js';
import { generateWeekPlan, savePlan, loadPlan } from './mealPlan.js';
import { sendToAll, alreadySent, markSent } from './notifications.js';
import { pruneExpiredSessions } from '../auth.js';

function todaySummary(dateISO) {
  const blocks = workoutsForDate(dateISO);
  if (blocks.length === 0) return 'Nothing scheduled.';
  if (blocks.length === 1 && blocks[0].block === 'rest') return 'Rest day. Protein and water.';
  return blocks
    .filter((b) => b.block !== 'rest')
    .map((b) => b.summary)
    .join(' Then: ');
}

function loggedAnythingToday(dateISO) {
  const workout = db.prepare('SELECT 1 FROM workout_logs WHERE date = ? LIMIT 1').get(dateISO);
  const weight = db.prepare('SELECT 1 FROM weigh_ins WHERE date = ? LIMIT 1').get(dateISO);
  const completed = db
    .prepare('SELECT 1 FROM workouts WHERE date = ? AND completed = 1 LIMIT 1')
    .get(dateISO);
  return { workout: Boolean(workout || completed), weight: Boolean(weight) };
}

async function runMealPlanJob(nextWeekStart) {
  const existing = loadPlan(nextWeekStart);
  if (existing) return existing.source;
  const { plan, source } = await generateWeekPlan(nextWeekStart);
  savePlan(nextWeekStart, plan, source);
  return source;
}

export async function runDueNotifications(now = new Date()) {
  const settings = getSettings();
  if (!settings) return [];

  const tz = settings.timezone || 'America/New_York';
  const today = localDate(tz, now);
  const time = localTime(tz, now);
  const dow = dayOfWeek(today);
  const results = [];

  ensurePlanThrough(today, 6);

  if (!settings.notify_enabled) return results;

  // 1. Morning workout summary.
  if (time === settings.notify_morning && !alreadySent('morning', today)) {
    const body = todaySummary(today);
    await sendToAll({
      title: 'Today on the plan',
      body,
      tag: 'morning',
      url: '/',
    });
    markSent('morning', today, body);
    results.push('morning');
  }

  // 2. Evening nudge, only if nothing has been logged.
  if (time === settings.notify_evening && !alreadySent('evening', today)) {
    const logged = loggedAnythingToday(today);
    if (!logged.workout || !logged.weight) {
      const missing = [];
      if (!logged.workout) missing.push('workout');
      if (!logged.weight) missing.push('weight');
      const body = `Nothing logged yet for ${missing.join(' or ')}. Two taps and it is done.`;
      await sendToAll({ title: 'Log before bed', body, tag: 'evening', url: '/' });
      markSent('evening', today, body);
      results.push('evening');
    }
  }

  // 3. Weekly meal plan, generated first and then announced.
  if (
    dow === settings.notify_mealplan_dow &&
    time === settings.notify_mealplan_time &&
    !alreadySent('mealplan', today)
  ) {
    const nextWeekStart = mondayOf(addDays(today, 1));
    let source = 'fallback';
    try {
      source = await runMealPlanJob(nextWeekStart);
    } catch (err) {
      console.error('Meal plan job failed:', err.message);
    }
    await sendToAll({
      title: 'Meal plan is ready',
      body: `The week of ${nextWeekStart} is built and the grocery list is grouped by store section.`,
      tag: 'mealplan',
      url: '/meals',
    });
    markSent('mealplan', today, source);
    results.push('mealplan');
  }

  // 4. Weekly weigh-in reminder.
  if (
    dow === settings.notify_weighin_dow &&
    time === settings.notify_weighin_time &&
    !alreadySent('weighin', today)
  ) {
    await sendToAll({
      title: 'Weigh-in',
      body: 'Same scale, same time, before you eat. Log it in the app.',
      tag: 'weighin',
      url: '/',
    });
    markSent('weighin', today);
    results.push('weighin');
  }

  // 5. Time trial heads up, Monday of a trial week.
  if (
    settings.notify_trial_headsup &&
    dow === 1 &&
    time === settings.notify_morning &&
    !alreadySent('trial_headsup', today)
  ) {
    const week = weekNumberFor(today);
    if (isTimeTrialWeek(week)) {
      await sendToAll({
        title: 'Time trial Wednesday',
        body: `Week ${week} is a test week. Wednesday is the 1.5 mile time trial, so keep Monday and Tuesday honest.`,
        tag: 'trial',
        url: '/progress',
      });
      markSent('trial_headsup', today, `week ${week}`);
      results.push('trial_headsup');
    }
  }

  return results;
}

let task = null;

export function startScheduler() {
  if (task) return task;
  const settings = getSettings();
  const tz = settings?.timezone || 'America/New_York';

  task = cron.schedule(
    '* * * * *',
    () => {
      runDueNotifications().catch((err) => console.error('Scheduler error:', err.message));
    },
    { timezone: tz }
  );

  // Daily housekeeping at 3:15 am local.
  cron.schedule(
    '15 3 * * *',
    () => {
      try {
        pruneExpiredSessions();
        ensurePlanThrough(localDate(tz), 6);
      } catch (err) {
        console.error('Housekeeping error:', err.message);
      }
    },
    { timezone: tz }
  );

  console.log(`Notification scheduler running in ${tz}.`);
  return task;
}

export function stopScheduler() {
  if (task) {
    task.stop();
    task = null;
  }
}
