import { Router } from 'express';
import { db } from '../db.js';
import { localDate, parseDuration, formatSeconds } from '../util/date.js';
import { STANDARDS } from '../standards.js';
import { testHistory } from '../services/progress.js';

const router = Router();

const TYPES = ['pushup', 'situp', 'run_trial'];

router.get('/', (req, res) => {
  const out = {};
  for (const type of TYPES) {
    out[type] = testHistory(type).map((row) => ({
      ...row,
      display: type === 'run_trial' ? formatSeconds(row.value) : row.value,
    }));
  }
  res.json({ tests: out, standards: STANDARDS });
});

router.post('/', (req, res) => {
  const { type } = req.body || {};
  if (!TYPES.includes(type)) {
    return res.status(400).json({ error: 'Type must be pushup, situp, or run_trial.' });
  }
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(req.body?.date || ''))
    ? req.body.date
    : localDate(req.settings?.timezone || 'America/New_York');

  const value = type === 'run_trial' ? parseDuration(req.body?.value) : Number(req.body?.value);
  if (!Number.isFinite(value) || value <= 0) {
    return res.status(400).json({
      error:
        type === 'run_trial'
          ? 'Enter the run time as minutes:seconds, for example 14:05.'
          : 'Enter the number of reps.',
    });
  }

  db.prepare('DELETE FROM test_results WHERE date = ? AND type = ?').run(date, type);
  db.prepare('INSERT INTO test_results (date, type, value, notes) VALUES (?, ?, ?, ?)').run(
    date,
    type,
    value,
    req.body?.notes || null
  );

  res.json({ ok: true, date, type, value });
});

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM test_results WHERE id = ?').run(Number(req.params.id));
  res.json({ ok: true });
});

export default router;
