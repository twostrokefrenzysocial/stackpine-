import { Router } from 'express';
import { getSettings } from '../db.js';
import { localDate, diffDays, dayName } from '../util/date.js';
import { ensurePlanThrough, workoutsForDate } from '../planStore.js';
import { weekNumberFor, weekSummary, mondayOf, PHASE_NOTES, phaseForWeek } from '../plan.js';
import { decorate, catchUpFor } from './workouts.js';
import { dayTotals } from './logs.js';
import { weightSummary, paceFlags, readinessCard } from '../services/progress.js';
import { loadPlan } from '../services/mealPlan.js';

const router = Router();

router.get('/', (req, res) => {
  const settings = getSettings();
  const today = localDate(settings.timezone);
  ensurePlanThrough(today, 6);

  const weekNumber = Math.max(1, weekNumberFor(today));
  const blocks = decorate(workoutsForDate(today));
  const mealWeek = mondayOf(today);
  const stored = loadPlan(mealWeek);
  const mealDay = stored?.plan?.days?.find((d) => d.date === today) || null;

  res.json({
    date: today,
    day_name: dayName(today),
    week: weekSummary(weekNumber, settings.phase_override),
    phase_note: PHASE_NOTES[phaseForWeek(weekNumber, settings.phase_override)],
    blocks,
    catch_up: catchUpFor(today),
    totals: dayTotals(today),
    weight: weightSummary(today),
    flags: paceFlags(today),
    readiness: readinessCard(),
    meals: mealDay,
    meal_week_start: mealWeek,
    has_meal_plan: Boolean(stored),
    countdown: settings.test_date
      ? { test_date: settings.test_date, days: diffDays(today, settings.test_date) }
      : null,
    plan_started: today >= settings.start_date,
  });
});

export default router;
