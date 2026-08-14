import { Router } from 'express';
import { getSettings } from '../db.js';
import { localDate, diffDays, formatSeconds, addDays } from '../util/date.js';
import { STANDARDS } from '../standards.js';
import {
  weighIns,
  weightSummary,
  paceFlags,
  weeklyAverages,
  readinessCard,
  testHistory,
  guideBand,
} from '../services/progress.js';

const router = Router();

router.get('/summary', (req, res) => {
  const settings = getSettings();
  const today = localDate(settings.timezone);

  const weights = weighIns();
  const lastDate = weights.length ? weights[weights.length - 1].date : today;
  const bandEnd = addDays(lastDate > today ? lastDate : today, 28);

  res.json({
    today,
    weight: weightSummary(today),
    weight_series: weights,
    weight_guide: guideBand(settings.start_weight, settings.start_date, bandEnd),
    weekly_averages: weeklyAverages(today, 12),
    flags: paceFlags(today),
    readiness: readinessCard(),
    tests: {
      pushup: testHistory('pushup'),
      situp: testHistory('situp'),
      run_trial: testHistory('run_trial').map((r) => ({ ...r, display: formatSeconds(r.value) })),
    },
    standards: STANDARDS,
    countdown: settings.test_date
      ? { test_date: settings.test_date, days: diffDays(today, settings.test_date) }
      : null,
  });
});

export default router;
