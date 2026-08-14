import { Router } from 'express';
import { db, getSettings } from '../db.js';
import { localDate } from '../util/date.js';
import { refreshFutureBlocks, ensurePlanThrough } from '../planStore.js';
import { INCLINE_LEVELS } from '../plan.js';
import { ALL_SLOTS } from '../services/mealPlan.js';

const router = Router();

const EDITABLE = [
  'name',
  'age',
  'sex',
  'test_date',
  'start_weight',
  'goal_weight',
  'protein_min',
  'protein_max',
  'water_goal_oz',
  'water_goal_oz_run_day',
  'meal_preferences',
  'meal_exclusions',
  'household_size',
  'pushup_incline',
  'equipment',
  'meal_slots',
  'phase_override',
  'on_glp1',
  'notify_enabled',
  'notify_morning',
  'notify_evening',
  'notify_mealplan_dow',
  'notify_mealplan_time',
  'notify_weighin_dow',
  'notify_weighin_time',
  'notify_trial_headsup',
  'timezone',
];

const TIME_FIELDS = new Set([
  'notify_morning',
  'notify_evening',
  'notify_mealplan_time',
  'notify_weighin_time',
]);

function publicSettings() {
  const s = getSettings();
  const { pin_hash: _pin, ...rest } = s;
  return rest;
}

router.get('/', (req, res) => {
  res.json({
    settings: publicSettings(),
    incline_levels: INCLINE_LEVELS,
    all_meal_slots: ALL_SLOTS,
  });
});

router.put('/', (req, res) => {
  const body = req.body || {};
  const updates = {};

  for (const key of EDITABLE) {
    if (!(key in body)) continue;
    let value = body[key];

    if (TIME_FIELDS.has(key)) {
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(value))) {
        return res.status(400).json({ error: `${key} needs to look like 07:00.` });
      }
    }
    if (key === 'pushup_incline' && !INCLINE_LEVELS.some((l) => l.key === value)) {
      return res.status(400).json({ error: 'That incline level is not one of the four.' });
    }
    if (key === 'equipment' && !['none', 'gym'].includes(value)) {
      return res.status(400).json({ error: "Equipment must be 'none' or 'gym'." });
    }
    if (key === 'meal_slots') {
      const list = Array.isArray(value) ? value.filter((v) => ALL_SLOTS.includes(v)) : [];
      if (list.length === 0) {
        return res.status(400).json({ error: 'Pick at least one meal you actually eat.' });
      }
      value = JSON.stringify(ALL_SLOTS.filter((s) => list.includes(s)));
    }
    if (key === 'phase_override') {
      value = value === null || value === '' ? null : Number(value);
      if (value !== null && ![1, 2, 3, 4].includes(value)) {
        return res.status(400).json({ error: 'Phase override must be 1, 2, 3, 4, or empty.' });
      }
    }
    if (key === 'test_date') {
      value = value ? String(value) : null;
      if (value && !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        return res.status(400).json({ error: 'Test date needs to look like 2027-03-14.' });
      }
    }
    if (['on_glp1', 'notify_enabled', 'notify_trial_headsup'].includes(key)) {
      value = value ? 1 : 0;
    }
    if (['protein_min', 'protein_max'].includes(key)) {
      value = Number(value);
      if (!Number.isFinite(value) || value <= 0) {
        return res.status(400).json({ error: `${key} needs to be a positive number.` });
      }
    }

    updates[key] = value;
  }

  if (Object.keys(updates).length === 0) {
    return res.json({ settings: publicSettings(), refreshed: 0 });
  }

  const before = getSettings();
  const assignments = Object.keys(updates)
    .map((k) => `${k} = @${k}`)
    .join(', ');
  db.prepare(
    `UPDATE settings SET ${assignments}, updated_at = datetime('now') WHERE id = 1`
  ).run(updates);

  const after = getSettings();
  if (after.protein_min > after.protein_max) {
    db.prepare('UPDATE settings SET protein_max = ? WHERE id = 1').run(after.protein_min + 30);
  }

  // If the incline or the phase changed, rewrite the prescriptions for days
  // that have not been touched yet.
  let refreshed = 0;
  if (
    before.pushup_incline !== after.pushup_incline ||
    before.phase_override !== after.phase_override ||
    before.equipment !== after.equipment
  ) {
    refreshed = refreshFutureBlocks(localDate(after.timezone));
  }
  ensurePlanThrough(localDate(after.timezone), 6);

  res.json({ settings: publicSettings(), refreshed });
});

export default router;
