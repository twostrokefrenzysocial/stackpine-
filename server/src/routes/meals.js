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
    const plan = stored.plan;
    const day = plan.days[dayIndex];
    day.meals = day.meals.map((m) => (m.slot === slot ? replacement : m));
    day.total_protein_g = Math.round(
      day.meals.reduce((sum, m) => sum + (Number(m.protein_g) || 0), 0)
    );
    savePlan(weekStart, plan, stored.source === 'ai' ? 'ai' : 'mixed');
    res.json({ ok: true, week_start: weekStart, plan, replaced: replacement });
  } catch (err) {
    res.status(502).json({ error: err.message });
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
