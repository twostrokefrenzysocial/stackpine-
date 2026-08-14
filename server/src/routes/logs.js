// Fast logging: weight, water, protein.

import { Router } from 'express';
import { db, getSettings } from '../db.js';
import { localDate } from '../util/date.js';

const router = Router();

function today(req) {
  return localDate(req.settings?.timezone || 'America/New_York');
}

function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
}

// Weight ------------------------------------------------------------------

router.get('/weight', (req, res) => {
  const rows = db.prepare('SELECT id, date, lbs, note FROM weigh_ins ORDER BY date ASC').all();
  res.json({ weigh_ins: rows });
});

router.post('/weight', (req, res) => {
  const date = validDate(req.body?.date) ? req.body.date : today(req);
  const lbs = Number(req.body?.lbs);
  if (!Number.isFinite(lbs) || lbs <= 0 || lbs > 1000) {
    return res.status(400).json({ error: 'That weight does not look right.' });
  }
  db.prepare(
    `INSERT INTO weigh_ins (date, lbs, note) VALUES (?, ?, ?)
     ON CONFLICT (date) DO UPDATE SET lbs = excluded.lbs, note = excluded.note`
  ).run(date, lbs, req.body?.note || null);
  res.json({ ok: true, date, lbs });
});

router.delete('/weight/:date', (req, res) => {
  db.prepare('DELETE FROM weigh_ins WHERE date = ?').run(req.params.date);
  res.json({ ok: true });
});

// Water -------------------------------------------------------------------

router.post('/water', (req, res) => {
  const date = validDate(req.body?.date) ? req.body.date : today(req);
  const oz = Number(req.body?.oz);
  if (!Number.isFinite(oz) || oz === 0) {
    return res.status(400).json({ error: 'Enter an amount in ounces.' });
  }
  db.prepare('INSERT INTO water_logs (date, oz) VALUES (?, ?)').run(date, oz);
  const total = db.prepare('SELECT COALESCE(SUM(oz), 0) AS total FROM water_logs WHERE date = ?').get(date);
  res.json({ ok: true, date, total_oz: total.total });
});

router.post('/water/reset', (req, res) => {
  const date = validDate(req.body?.date) ? req.body.date : today(req);
  db.prepare('DELETE FROM water_logs WHERE date = ?').run(date);
  res.json({ ok: true, date, total_oz: 0 });
});

// Protein -----------------------------------------------------------------

router.post('/protein', (req, res) => {
  const date = validDate(req.body?.date) ? req.body.date : today(req);
  const grams = Number(req.body?.grams);
  if (!Number.isFinite(grams) || grams === 0) {
    return res.status(400).json({ error: 'Enter an amount in grams.' });
  }
  db.prepare('INSERT INTO protein_logs (date, grams, note) VALUES (?, ?, ?)').run(
    date,
    grams,
    req.body?.note || null
  );
  const total = db
    .prepare('SELECT COALESCE(SUM(grams), 0) AS total FROM protein_logs WHERE date = ?')
    .get(date);
  res.json({ ok: true, date, total_grams: total.total });
});

router.post('/protein/reset', (req, res) => {
  const date = validDate(req.body?.date) ? req.body.date : today(req);
  db.prepare('DELETE FROM protein_logs WHERE date = ?').run(date);
  res.json({ ok: true, date, total_grams: 0 });
});

// Day rollup --------------------------------------------------------------

export function dayTotals(date) {
  const settings = getSettings();
  const water = db
    .prepare('SELECT COALESCE(SUM(oz), 0) AS total FROM water_logs WHERE date = ?')
    .get(date).total;
  const protein = db
    .prepare('SELECT COALESCE(SUM(grams), 0) AS total FROM protein_logs WHERE date = ?')
    .get(date).total;
  const weight = db.prepare('SELECT lbs FROM weigh_ins WHERE date = ?').get(date);
  const isRunDay = Boolean(
    db.prepare("SELECT 1 FROM workouts WHERE date = ? AND block = 'run'").get(date)
  );
  return {
    date,
    water_oz: water,
    water_goal_oz: isRunDay ? settings.water_goal_oz_run_day : settings.water_goal_oz,
    protein_g: protein,
    protein_min: settings.protein_min,
    protein_max: settings.protein_max,
    weight_lbs: weight ? weight.lbs : null,
    run_day: isRunDay,
  };
}

router.get('/day', (req, res) => {
  const date = validDate(req.query.date) ? req.query.date : today(req);
  res.json(dayTotals(date));
});

export default router;
