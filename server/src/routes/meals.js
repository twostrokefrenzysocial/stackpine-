import { Router } from 'express';
import { db, getSettings } from '../db.js';
import { localDate } from '../util/date.js';
import { mondayOf } from '../plan.js';
import {
  generateWeekPlan,
  regenerateMeal,
  savePlan,
  loadPlan,
  listPlanWeeks,
  rebuildGrocery,
  hasApiKey,
  buildPastePrompt,
  importPlanText,
  buildMealPastePrompt,
  importMealText,
  applyMeal,
  PlanImportError,
  SECTIONS,
} from '../services/mealPlan.js';

const router = Router();

function weekParam(req) {
  const raw = req.query.week_start || req.body?.week_start;
  if (raw && /^\d{4}-\d{2}-\d{2}$/.test(raw)) return mondayOf(raw);
  return mondayOf(localDate(req.settings?.timezone || 'America/New_York'));
}

router.get('/weeks', (req, res) => {
  res.json({ weeks: listPlanWeeks(), api_key_configured: hasApiKey() });
});

router.get('/plan', (req, res) => {
  const weekStart = weekParam(req);
  const stored = loadPlan(weekStart);
  res.json({
    week_start: weekStart,
    plan: stored ? stored.plan : null,
    source: stored ? stored.source : null,
    updated_at: stored ? stored.updated_at : null,
    api_key_configured: hasApiKey(),
  });
});

// Returns the prompt to paste into ChatGPT, Claude, or anything else. This is
// the free path: it uses whatever assistant subscription you already have.
router.get('/prompt', (req, res) => {
  const weekStart = weekParam(req);
  res.json({ week_start: weekStart, prompt: buildPastePrompt(weekStart) });
});

// Takes the assistant's reply and saves it as the week.
router.post('/import', (req, res) => {
  const weekStart = weekParam(req);
  try {
    const plan = importPlanText(weekStart, req.body?.text);
    savePlan(weekStart, plan, 'pasted');
    res.json({ ok: true, week_start: weekStart, plan, source: 'pasted' });
  } catch (err) {
    if (err instanceof PlanImportError) {
      return res.status(400).json({ error: err.message, details: err.details });
    }
    return res.status(400).json({ error: err.message });
  }
});

router.post('/generate', async (req, res) => {
  const weekStart = weekParam(req);
  const force = Boolean(req.body?.force);
  const existing = loadPlan(weekStart);
  if (existing && !force) {
    return res.json({ week_start: weekStart, plan: existing.plan, source: existing.source, reused: true });
  }

  try {
    const { plan, source, reason } = await generateWeekPlan(weekStart);
    savePlan(weekStart, plan, source);
    res.json({ week_start: weekStart, plan, source, reason: reason || null, reused: false });
  } catch (err) {
    res.status(502).json({ error: `Meal plan generation failed: ${err.message}` });
  }
});

router.post('/swap-meal', async (req, res) => {
  const weekStart = weekParam(req);
  const stored = loadPlan(weekStart);
  if (!stored) return res.status(404).json({ error: 'There is no plan for that week yet.' });

  const dayIndex = Number(req.body?.day_index);
  const slot = String(req.body?.slot || '');
  if (!Number.isInteger(dayIndex) || dayIndex < 0 || dayIndex > 6) {
    return res.status(400).json({ error: 'day_index must be 0 through 6.' });
  }

  try {
    const replacement = await regenerateMeal(stored.plan, dayIndex, slot);
    const plan = applyMeal(stored.plan, dayIndex, slot, replacement);
    savePlan(weekStart, plan, 'mixed');
    res.json({ ok: true, week_start: weekStart, plan, replaced: replacement });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// Per meal version of the paste flow. Same two steps: copy a prompt, paste the
// reply back. No API key involved.
router.get('/meal-prompt', (req, res) => {
  const weekStart = weekParam(req);
  const stored = loadPlan(weekStart);
  if (!stored) return res.status(404).json({ error: 'There is no plan for that week yet.' });

  const dayIndex = Number(req.query.day_index);
  const slot = String(req.query.slot || '');
  if (!Number.isInteger(dayIndex) || dayIndex < 0 || dayIndex > 6) {
    return res.status(400).json({ error: 'day_index must be 0 through 6.' });
  }

  try {
    res.json({
      week_start: weekStart,
      day_index: dayIndex,
      slot,
      prompt: buildMealPastePrompt(stored.plan, dayIndex, slot),
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/meal-import', (req, res) => {
  const weekStart = weekParam(req);
  const stored = loadPlan(weekStart);
  if (!stored) return res.status(404).json({ error: 'There is no plan for that week yet.' });

  const dayIndex = Number(req.body?.day_index);
  const slot = String(req.body?.slot || '');
  if (!Number.isInteger(dayIndex) || dayIndex < 0 || dayIndex > 6) {
    return res.status(400).json({ error: 'day_index must be 0 through 6.' });
  }

  try {
    const replacement = importMealText(stored.plan, dayIndex, slot, req.body?.text);
    const plan = applyMeal(stored.plan, dayIndex, slot, replacement);
    savePlan(weekStart, plan, 'mixed');
    res.json({ ok: true, week_start: weekStart, plan, replaced: replacement });
  } catch (err) {
    if (err instanceof PlanImportError) {
      return res.status(400).json({ error: err.message, details: err.details });
    }
    return res.status(400).json({ error: err.message });
  }
});

// Grocery list ------------------------------------------------------------

router.get('/grocery', (req, res) => {
  const weekStart = weekParam(req);
  const rows = db
    .prepare('SELECT * FROM grocery_items WHERE week_start = ? ORDER BY sort_order ASC')
    .all(weekStart);

  const grouped = [];
  for (const section of SECTIONS) {
    const items = rows.filter((r) => r.section === section);
    if (items.length) grouped.push({ section, items });
  }

  res.json({
    week_start: weekStart,
    sections: grouped,
    total: rows.length,
    remaining: rows.filter((r) => !r.checked).length,
  });
});

router.put('/grocery/:id', (req, res) => {
  const id = Number(req.params.id);
  const checked = req.body?.checked ? 1 : 0;
  const result = db.prepare('UPDATE grocery_items SET checked = ? WHERE id = ?').run(checked, id);
  if (result.changes === 0) return res.status(404).json({ error: 'No such grocery item.' });
  res.json({ ok: true, id, checked });
});

router.post('/grocery/reset', (req, res) => {
  const weekStart = weekParam(req);
  db.prepare('UPDATE grocery_items SET checked = 0 WHERE week_start = ?').run(weekStart);
  res.json({ ok: true, week_start: weekStart });
});

router.post('/grocery/rebuild', (req, res) => {
  const weekStart = weekParam(req);
  const stored = loadPlan(weekStart);
  if (!stored) return res.status(404).json({ error: 'There is no plan for that week yet.' });
  const count = rebuildGrocery(weekStart, stored.plan);
  res.json({ ok: true, week_start: weekStart, items: count });
});

export default router;
