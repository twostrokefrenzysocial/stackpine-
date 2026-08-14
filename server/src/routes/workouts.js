import { Router } from 'express';
import { db, getSettings } from '../db.js';
import { localDate, addDays, dayName, parseDuration } from '../util/date.js';
import {
  workoutsForDate,
  workoutsBetween,
  workoutsForWeek,
  hydrate,
  swapDays,
  ensurePlanThrough,
  refreshFutureBlocks,
} from '../planStore.js';
import {
  weekNumberFor,
  weekSummary,
  weekStartFor,
  weekEndFor,
  inclineLabel,
  nextIncline,
} from '../plan.js';

const router = Router();

function today(req) {
  return localDate(req.settings?.timezone || 'America/New_York');
}

function logsForDates(dates) {
  if (dates.length === 0) return new Map();
  const placeholders = dates.map(() => '?').join(',');
  const rows = db
    .prepare(`SELECT * FROM workout_logs WHERE date IN (${placeholders}) ORDER BY id ASC`)
    .all(...dates);
  const map = new Map();
  for (const row of rows) {
    let sets = null;
    try {
      sets = row.sets_json ? JSON.parse(row.sets_json) : null;
    } catch {
      sets = null;
    }
    const key = row.workout_id ?? `${row.date}:${row.type}`;
    map.set(key, { ...row, sets });
  }
  return map;
}

export function decorate(blocks) {
  const dates = [...new Set(blocks.map((b) => b.date))];
  const logs = logsForDates(dates);
  return blocks.map((b) => ({
    ...b,
    day_name: dayName(b.date),
    log: logs.get(b.id) || logs.get(`${b.date}:${b.block}`) || null,
  }));
}

// Week view ---------------------------------------------------------------

router.get('/week', (req, res) => {
  const settings = getSettings();
  const todayISO = today(req);
  ensurePlanThrough(todayISO, 6);

  const weekNumber = req.query.week
    ? Number(req.query.week)
    : Math.max(1, weekNumberFor(todayISO));
  if (!Number.isFinite(weekNumber) || weekNumber < 1) {
    return res.status(400).json({ error: 'That week number is not valid.' });
  }
  ensurePlanThrough(weekEndFor(weekNumber), 1);

  const blocks = decorate(workoutsForWeek(weekNumber));
  const byDate = new Map();
  for (const block of blocks) {
    if (!byDate.has(block.date)) byDate.set(block.date, []);
    byDate.get(block.date).push(block);
  }

  res.json({
    ...weekSummary(weekNumber, settings.phase_override),
    today: todayISO,
    days: [...byDate.entries()].map(([date, items]) => ({
      date,
      day_name: dayName(date),
      blocks: items,
      complete: items.every((i) => i.completed || i.block === 'rest'),
    })),
  });
});

router.get('/range', (req, res) => {
  const from = req.query.from || addDays(today(req), -14);
  const to = req.query.to || addDays(today(req), 14);
  res.json({ workouts: decorate(workoutsBetween(from, to)) });
});

router.get('/date/:date', (req, res) => {
  res.json({ date: req.params.date, blocks: decorate(workoutsForDate(req.params.date)) });
});

// Move a day --------------------------------------------------------------

router.post('/swap', (req, res) => {
  const { date_a: a, date_b: b } = req.body || {};
  if (!a || !b) return res.status(400).json({ error: 'Pick two days to swap.' });
  const hasA = db.prepare('SELECT 1 FROM workouts WHERE date = ? LIMIT 1').get(a);
  const hasB = db.prepare('SELECT 1 FROM workouts WHERE date = ? LIMIT 1').get(b);
  if (!hasA || !hasB) return res.status(404).json({ error: 'One of those days is not scheduled.' });
  swapDays(a, b);
  res.json({ ok: true, blocks_a: decorate(workoutsForDate(a)), blocks_b: decorate(workoutsForDate(b)) });
});

// Completion --------------------------------------------------------------

router.post('/:id/complete', (req, res) => {
  const id = Number(req.params.id);
  const done = req.body?.completed === false ? 0 : 1;
  const result = db
    .prepare(
      `UPDATE workouts SET completed = ?, completed_at = CASE WHEN ? = 1 THEN datetime('now') ELSE NULL END WHERE id = ?`
    )
    .run(done, done, id);
  if (result.changes === 0) return res.status(404).json({ error: 'No such workout block.' });
  res.json({ ok: true, workout: hydrate(db.prepare('SELECT * FROM workouts WHERE id = ?').get(id)) });
});

router.post('/:id/skip', (req, res) => {
  const id = Number(req.params.id);
  db.prepare('UPDATE workouts SET skipped = 1 WHERE id = ?').run(id);
  res.json({ ok: true });
});

// Logging -----------------------------------------------------------------

function insertLog(payload) {
  return db
    .prepare(
      `INSERT INTO workout_logs
        (workout_id, date, type, duration_min, distance_mi, intervals_completed,
         incline_level, sets_json, plank_seconds, felt, notes)
       VALUES
        (@workout_id, @date, @type, @duration_min, @distance_mi, @intervals_completed,
         @incline_level, @sets_json, @plank_seconds, @felt, @notes)`
    )
    .run(payload);
}

router.post('/:id/log', (req, res) => {
  const id = Number(req.params.id);
  const workout = hydrate(db.prepare('SELECT * FROM workouts WHERE id = ?').get(id));
  if (!workout) return res.status(404).json({ error: 'No such workout block.' });

  const body = req.body || {};
  const felt = Number.isFinite(Number(body.felt)) ? Number(body.felt) : null;
  const notes = body.notes ? String(body.notes) : null;
  const messages = [];

  db.prepare('DELETE FROM workout_logs WHERE workout_id = ?').run(id);
  db.prepare('DELETE FROM strength_logs WHERE workout_id = ?').run(id);

  if (workout.block === 'run') {
    insertLog({
      workout_id: id,
      date: workout.date,
      type: workout.is_time_trial ? 'run_trial' : 'run',
      duration_min: Number.isFinite(Number(body.duration_min)) ? Number(body.duration_min) : null,
      distance_mi: Number.isFinite(Number(body.distance_mi)) ? Number(body.distance_mi) : null,
      intervals_completed: Number.isFinite(Number(body.intervals_completed))
        ? Number(body.intervals_completed)
        : null,
      incline_level: null,
      sets_json: null,
      plank_seconds: null,
      felt,
      notes,
    });

    if (workout.is_time_trial) {
      const seconds = parseDuration(body.trial_time);
      if (!seconds || seconds <= 0) {
        return res.status(400).json({ error: 'Enter the time trial result as minutes:seconds.' });
      }
      db.prepare('DELETE FROM test_results WHERE date = ? AND type = ?').run(workout.date, 'run_trial');
      db.prepare('INSERT INTO test_results (date, type, value, notes) VALUES (?, ?, ?, ?)').run(
        workout.date,
        'run_trial',
        seconds,
        notes
      );
      messages.push('Time trial recorded.');
    }
  } else if (workout.block === 'pushups_situps') {
    const settings = getSettings();
    const pushupSets = (body.pushup_sets || []).map(Number).filter((n) => Number.isFinite(n));
    const situpSets = (body.situp_sets || []).map(Number).filter((n) => Number.isFinite(n));
    const planks = (body.plank_seconds || []).map(Number).filter((n) => Number.isFinite(n));
    const incline = body.incline_level || settings.pushup_incline;

    insertLog({
      workout_id: id,
      date: workout.date,
      type: 'pushups_situps',
      duration_min: null,
      distance_mi: null,
      intervals_completed: null,
      incline_level: incline,
      sets_json: JSON.stringify({ pushups: pushupSets, situps: situpSets }),
      plank_seconds: JSON.stringify(planks),
      felt,
      notes,
    });

    // Weekly max tests.
    const pushupTest = Number(body.pushup_test);
    const situpTest = Number(body.situp_test);
    if (Number.isFinite(pushupTest) && pushupTest > 0) {
      db.prepare('DELETE FROM test_results WHERE date = ? AND type = ?').run(workout.date, 'pushup');
      db.prepare('INSERT INTO test_results (date, type, value) VALUES (?, ?, ?)').run(
        workout.date,
        'pushup',
        pushupTest
      );
      messages.push('Push-up test recorded.');
    }
    if (Number.isFinite(situpTest) && situpTest > 0) {
      db.prepare('DELETE FROM test_results WHERE date = ? AND type = ?').run(workout.date, 'situp');
      db.prepare('INSERT INTO test_results (date, type, value) VALUES (?, ?, ?)').run(
        workout.date,
        'situp',
        situpTest
      );
      messages.push('Sit-up test recorded.');
    }

    // Progression: 15 reps on every set at this incline means it is time to drop.
    if (
      incline === settings.pushup_incline &&
      pushupSets.length >= 5 &&
      pushupSets.every((n) => n >= 15)
    ) {
      const next = nextIncline(settings.pushup_incline);
      if (next) {
        db.prepare('UPDATE settings SET pushup_incline = ? WHERE id = 1').run(next);
        refreshFutureBlocks(workout.date);
        messages.push(
          `Every set hit 15 at ${inclineLabel(incline)}. Moving you down to ${inclineLabel(next)}.`
        );
      } else {
        messages.push('Every set hit 15 on the floor. Hold the 5 set structure and keep building.');
      }
    }
  } else if (workout.block === 'strength') {
    const entries = Array.isArray(body.entries) ? body.entries : [];
    insertLog({
      workout_id: id,
      date: workout.date,
      type: 'strength',
      duration_min: Number.isFinite(Number(body.duration_min)) ? Number(body.duration_min) : null,
      distance_mi: null,
      intervals_completed: null,
      incline_level: null,
      sets_json: JSON.stringify(entries),
      plank_seconds: null,
      felt,
      notes,
    });

    const insertStrength = db.prepare(
      'INSERT INTO strength_logs (workout_id, date, exercise, set_index, weight, reps) VALUES (?, ?, ?, ?, ?, ?)'
    );
    const run = db.transaction(() => {
      for (const entry of entries) {
        const sets = Array.isArray(entry.sets) ? entry.sets : [];
        sets.forEach((set, i) => {
          insertStrength.run(
            id,
            workout.date,
            String(entry.exercise || 'Exercise'),
            i + 1,
            Number.isFinite(Number(set.weight)) ? Number(set.weight) : null,
            Number.isFinite(Number(set.reps)) ? Number(set.reps) : null
          );
        });
      }
    });
    run();
  } else {
    insertLog({
      workout_id: id,
      date: workout.date,
      type: workout.block,
      duration_min: null,
      distance_mi: null,
      intervals_completed: null,
      incline_level: null,
      sets_json: null,
      plank_seconds: null,
      felt,
      notes,
    });
  }

  db.prepare("UPDATE workouts SET completed = 1, completed_at = datetime('now') WHERE id = ?").run(id);

  res.json({
    ok: true,
    messages,
    blocks: decorate(workoutsForDate(workout.date)),
  });
});

// Catch-up suggestion -----------------------------------------------------

export function catchUpFor(dateISO) {
  const yesterday = addDays(dateISO, -1);
  const missed = workoutsForDate(yesterday).filter(
    (b) => b.block !== 'rest' && !b.completed && !b.skipped
  );
  if (missed.length === 0) return null;
  return {
    date: yesterday,
    day_name: dayName(yesterday),
    missed: missed.map((b) => ({ id: b.id, title: b.title, summary: b.summary, block: b.block })),
    suggestion:
      missed.length === 1
        ? `You missed ${missed[0].title.toLowerCase()} yesterday. If today feels good, add a shortened version after what is already scheduled. Do not run two full sessions back to back.`
        : 'You missed yesterday. Pick the one piece that matters most and add a shortened version today. Do not stack a double session.',
  };
}

export default router;
