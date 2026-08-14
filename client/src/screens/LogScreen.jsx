import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { Card, ErrorNote, Field, Spinner, Toast } from '../components/ui.jsx';
import { BLOCK_LABELS, addDays, longDate, todayISO } from '../lib/format.js';

function FeltPicker({ value, onChange }) {
  const labels = ['Rough', 'Hard', 'Fine', 'Good', 'Strong'];
  return (
    <Field label="How did it feel">
      <div className="grid grid-cols-5 gap-1.5">
        {labels.map((label, i) => {
          const score = i + 1;
          const active = value === score;
          return (
            <button
              key={label}
              type="button"
              onClick={() => onChange(active ? null : score)}
              className={`rounded-xl border py-2 text-[11px] min-h-[52px] flex flex-col items-center justify-center gap-0.5 ${
                active ? 'border-series bg-series/15 text-ink' : 'border-white/10 bg-raised text-muted'
              }`}
            >
              <span className="text-sm font-bold tabular-nums">{score}</span>
              {label}
            </button>
          );
        })}
      </div>
    </Field>
  );
}

function SetRow({ index, value, onChange, placeholder }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-14 text-xs text-muted shrink-0">Set {index + 1}</span>
      <input
        type="number"
        inputMode="numeric"
        className="field tabular-nums"
        value={value ?? ''}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
      />
    </div>
  );
}

function RunForm({ block, onSubmit, busy }) {
  const existing = block.log || {};
  const [duration, setDuration] = useState(existing.duration_min ?? '');
  const [distance, setDistance] = useState(existing.distance_mi ?? block.details.distance_mi ?? '');
  const [intervals, setIntervals] = useState(
    existing.intervals_completed ?? block.details.repeats ?? ''
  );
  const [trialTime, setTrialTime] = useState('');
  const [felt, setFelt] = useState(existing.felt ?? null);
  const [notes, setNotes] = useState(existing.notes ?? '');

  const showIntervals = ['walk_jog', 'interval_build', 'intervals'].includes(block.details.kind);

  return (
    <div className="space-y-4">
      {Boolean(block.is_time_trial) && (
        <Field label="Time trial result" hint="Minutes and seconds, for example 14:05.">
          <input
            type="text"
            inputMode="numeric"
            placeholder="14:05"
            className="field text-2xl font-bold text-center tabular-nums"
            value={trialTime}
            onChange={(e) => setTrialTime(e.target.value)}
          />
        </Field>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Field label="Duration (min)">
          <input
            type="number"
            inputMode="decimal"
            className="field tabular-nums"
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
          />
        </Field>
        <Field label="Distance (mi)">
          <input
            type="number"
            inputMode="decimal"
            step="0.1"
            className="field tabular-nums"
            value={distance}
            onChange={(e) => setDistance(e.target.value)}
          />
        </Field>
      </div>

      {showIntervals && (
        <Field
          label="Intervals completed"
          hint={`Prescribed: ${block.details.repeats ?? '-'}${
            block.details.jog_minutes ? ` at ${block.details.jog_minutes} min jog` : ''
          }`}
        >
          <input
            type="number"
            inputMode="numeric"
            className="field tabular-nums"
            value={intervals}
            onChange={(e) => setIntervals(e.target.value)}
          />
        </Field>
      )}

      <FeltPicker value={felt} onChange={setFelt} />

      <Field label="Notes">
        <textarea
          className="field min-h-[72px]"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Optional"
        />
      </Field>

      <button
        type="button"
        className="btn-primary w-full disabled:opacity-50"
        disabled={busy || (block.is_time_trial && !trialTime.trim())}
        onClick={() =>
          onSubmit({
            duration_min: duration === '' ? null : Number(duration),
            distance_mi: distance === '' ? null : Number(distance),
            intervals_completed: intervals === '' ? null : Number(intervals),
            trial_time: trialTime.trim() || undefined,
            felt,
            notes,
          })
        }
      >
        {busy ? 'Saving' : 'Save run'}
      </button>
    </div>
  );
}

function CalisthenicsForm({ block, onSubmit, busy, inclineLevels }) {
  const existing = block.log || {};
  const prior = existing.sets || {};
  const [pushups, setPushups] = useState(prior.pushups?.length === 5 ? prior.pushups : Array(5).fill(null));
  const [situps, setSitups] = useState(prior.situps?.length === 4 ? prior.situps : Array(4).fill(null));
  const [planks, setPlanks] = useState(Array(3).fill(null));
  const [incline, setIncline] = useState(existing.incline_level || block.details.incline);
  const [pushupTest, setPushupTest] = useState('');
  const [situpTest, setSitupTest] = useState('');
  const [felt, setFelt] = useState(existing.felt ?? null);
  const [notes, setNotes] = useState(existing.notes ?? '');

  const update = (arr, setter) => (i, v) => setter(arr.map((old, idx) => (idx === i ? v : old)));

  return (
    <div className="space-y-4">
      {Boolean(block.is_test_day) && (
        <div className="rounded-card border border-series/40 bg-series/10 p-3 space-y-3">
          <p className="text-sm font-semibold">Weekly one minute max tests</p>
          <p className="text-xs text-ink-2">
            Test format: push-ups rest only in the up position, sit-ups knees bent with hands behind
            the head and feet anchored.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Push-ups">
              <input
                type="number"
                inputMode="numeric"
                className="field text-xl font-bold text-center tabular-nums"
                value={pushupTest}
                onChange={(e) => setPushupTest(e.target.value)}
              />
            </Field>
            <Field label="Sit-ups">
              <input
                type="number"
                inputMode="numeric"
                className="field text-xl font-bold text-center tabular-nums"
                value={situpTest}
                onChange={(e) => setSitupTest(e.target.value)}
              />
            </Field>
          </div>
        </div>
      )}

      <Field
        label="Push-up incline"
        hint="Hit 15 on all five sets and the app moves you down a level."
      >
        <select className="field" value={incline} onChange={(e) => setIncline(e.target.value)}>
          {inclineLevels.map((level) => (
            <option key={level.key} value={level.key}>
              {level.label}
            </option>
          ))}
        </select>
      </Field>

      <div>
        <p className="label mb-1.5">Push-ups, 5 sets, 90 sec rest</p>
        <div className="space-y-2">
          {pushups.map((value, i) => (
            <SetRow
              key={i}
              index={i}
              value={value}
              placeholder="reps"
              onChange={(v) => update(pushups, setPushups)(i, v)}
            />
          ))}
        </div>
      </div>

      <div>
        <p className="label mb-1.5">Sit-ups, 4 sets, 60 sec rest</p>
        <div className="space-y-2">
          {situps.map((value, i) => (
            <SetRow
              key={i}
              index={i}
              value={value}
              placeholder="reps"
              onChange={(v) => update(situps, setSitups)(i, v)}
            />
          ))}
        </div>
      </div>

      <div>
        <p className="label mb-1.5">Planks, 3 sets, 30 to 60 sec</p>
        <div className="space-y-2">
          {planks.map((value, i) => (
            <SetRow
              key={i}
              index={i}
              value={value}
              placeholder="seconds"
              onChange={(v) => update(planks, setPlanks)(i, v)}
            />
          ))}
        </div>
      </div>

      <FeltPicker value={felt} onChange={setFelt} />

      <Field label="Notes">
        <textarea
          className="field min-h-[72px]"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Optional"
        />
      </Field>

      <button
        type="button"
        className="btn-primary w-full disabled:opacity-50"
        disabled={busy}
        onClick={() =>
          onSubmit({
            pushup_sets: pushups.filter((n) => n !== null),
            situp_sets: situps.filter((n) => n !== null),
            plank_seconds: planks.filter((n) => n !== null),
            incline_level: incline,
            pushup_test: pushupTest === '' ? undefined : Number(pushupTest),
            situp_test: situpTest === '' ? undefined : Number(situpTest),
            felt,
            notes,
          })
        }
      >
        {busy ? 'Saving' : 'Save session'}
      </button>
    </div>
  );
}

function StrengthForm({ block, onSubmit, busy }) {
  const existing = block.log || {};
  const exercises = block.details.exercises || [];
  const bodyweight = block.details.equipment === 'none';
  const [entries, setEntries] = useState(() => {
    if (Array.isArray(existing.sets) && existing.sets.length) return existing.sets;
    return exercises.map((ex) => ({
      exercise: ex.name,
      sets: Array.from({ length: 3 }, () => ({ weight: null, reps: null })),
    }));
  });
  const [felt, setFelt] = useState(existing.felt ?? null);
  const [notes, setNotes] = useState(existing.notes ?? '');

  function setCell(exIndex, setIndex, field, value) {
    setEntries((prev) =>
      prev.map((entry, i) =>
        i !== exIndex
          ? entry
          : {
              ...entry,
              sets: entry.sets.map((s, j) =>
                j !== setIndex ? s : { ...s, [field]: value === '' ? null : Number(value) }
              ),
            }
      )
    );
  }

  return (
    <div className="space-y-5">
      <p className="text-xs text-muted">
        3 sets of 8 to 12 on each.{' '}
        {bodyweight
          ? `${block.details.level || ''} bodyweight work. Log reps, and only add a weight if you loaded a backpack.`.trim()
          : 'Log weight and reps per set.'}
      </p>

      {entries.map((entry, exIndex) => (
        <div key={entry.exercise}>
          <p className="label mb-1.5">{entry.exercise}</p>
          {exercises[exIndex]?.cue && (
            <p className="text-xs text-muted mb-2 -mt-1">{exercises[exIndex].cue}</p>
          )}
          <div className="space-y-2">
            {entry.sets.map((set, setIndex) => (
              <div key={setIndex} className="flex items-center gap-2">
                <span className="w-14 text-xs text-muted shrink-0">Set {setIndex + 1}</span>
                <input
                  type="number"
                  inputMode="decimal"
                  placeholder={bodyweight ? 'added lbs' : 'lbs'}
                  className="field tabular-nums"
                  value={set.weight ?? ''}
                  onChange={(e) => setCell(exIndex, setIndex, 'weight', e.target.value)}
                />
                <input
                  type="number"
                  inputMode="numeric"
                  placeholder="reps"
                  className="field tabular-nums"
                  value={set.reps ?? ''}
                  onChange={(e) => setCell(exIndex, setIndex, 'reps', e.target.value)}
                />
              </div>
            ))}
          </div>
        </div>
      ))}

      <FeltPicker value={felt} onChange={setFelt} />

      <Field label="Notes">
        <textarea
          className="field min-h-[72px]"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Optional"
        />
      </Field>

      <button
        type="button"
        className="btn-primary w-full disabled:opacity-50"
        disabled={busy}
        onClick={() => onSubmit({ entries, felt, notes })}
      >
        {busy ? 'Saving' : 'Save strength'}
      </button>
    </div>
  );
}

export default function LogScreen() {
  const [params, setParams] = useSearchParams();
  const date = params.get('date') || todayISO();
  const activeId = params.get('block');

  const [blocks, setBlocks] = useState(null);
  const [inclineLevels, setInclineLevels] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState('');
  const [swapTarget, setSwapTarget] = useState('');

  const load = useCallback(async () => {
    try {
      setError('');
      const [day, settings] = await Promise.all([api.workoutsForDate(date), api.settings()]);
      setBlocks(day.blocks);
      setInclineLevels(settings.incline_levels);
    } catch (err) {
      setError(err.message);
    }
  }, [date]);

  useEffect(() => {
    load();
  }, [load]);

  const selected = useMemo(() => {
    if (!blocks) return null;
    if (activeId) return blocks.find((b) => String(b.id) === String(activeId)) || null;
    return blocks.find((b) => b.block !== 'rest' && !b.completed) || null;
  }, [blocks, activeId]);

  function move(delta) {
    setParams({ date: addDays(date, delta) });
  }

  function select(block) {
    setParams({ date, block: String(block.id) });
  }

  async function submit(payload) {
    if (!selected) return;
    setBusy(true);
    try {
      const res = await api.logWorkout(selected.id, payload);
      setBlocks(res.blocks);
      setToast(res.messages.length ? res.messages.join(' ') : 'Logged.');
      setParams({ date });
    } catch (err) {
      setToast(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function doSwap() {
    if (!swapTarget) return;
    setBusy(true);
    try {
      await api.swapDays(date, swapTarget);
      setSwapTarget('');
      setToast('Days swapped.');
      load();
    } catch (err) {
      setToast(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (error) return <ErrorNote onRetry={load}>{error}</ErrorNote>;
  if (!blocks) return <Spinner label="Loading the day" />;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <button type="button" className="btn-tap w-14 h-11" onClick={() => move(-1)} aria-label="Previous day">
          ←
        </button>
        <div className="text-center">
          <p className="font-semibold">{longDate(date)}</p>
          <button
            type="button"
            className="text-xs text-series"
            onClick={() => setParams({ date: todayISO() })}
          >
            Jump to today
          </button>
        </div>
        <button type="button" className="btn-tap w-14 h-11" onClick={() => move(1)} aria-label="Next day">
          →
        </button>
      </div>

      {blocks.length === 0 ? (
        <Card>
          <p className="text-sm text-muted">Nothing scheduled on this date.</p>
        </Card>
      ) : (
        <>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {blocks.map((block) => (
              <button
                key={block.id}
                type="button"
                onClick={() => select(block)}
                className={`shrink-0 rounded-xl border px-3 py-2 text-xs min-h-[48px] ${
                  selected?.id === block.id
                    ? 'border-series bg-series/15 text-ink'
                    : 'border-white/10 bg-raised text-muted'
                }`}
              >
                {BLOCK_LABELS[block.block] || block.block}
                {Boolean(block.completed) && (
                  <span className="ml-1.5 text-good" aria-label="logged">
                    ✓
                  </span>
                )}
              </button>
            ))}
          </div>

          {selected && selected.block !== 'rest' ? (
            <Card title={selected.title}>
              <p className="text-sm text-ink-2 mb-4">{selected.summary}</p>
              {selected.details.note && (
                <p className="text-xs text-muted mb-4">{selected.details.note}</p>
              )}

              {selected.block === 'run' && (
                <RunForm block={selected} onSubmit={submit} busy={busy} />
              )}
              {selected.block === 'pushups_situps' && (
                <CalisthenicsForm
                  block={selected}
                  onSubmit={submit}
                  busy={busy}
                  inclineLevels={inclineLevels}
                />
              )}
              {selected.block === 'strength' && (
                <StrengthForm block={selected} onSubmit={submit} busy={busy} />
              )}
            </Card>
          ) : (
            <Card>
              <p className="text-sm text-muted">
                {blocks.some((b) => b.block === 'rest')
                  ? 'Rest day. Nothing to log beyond weight, water, and protein.'
                  : 'Everything on this day is logged. Pick a block above to edit it.'}
              </p>
            </Card>
          )}

          <Card title="Move this day">
            <p className="text-xs text-muted mb-2">
              Life happens. Swap this day with another and the whole block moves with it.
            </p>
            <div className="flex gap-2">
              <input
                type="date"
                className="field"
                value={swapTarget}
                onChange={(e) => setSwapTarget(e.target.value)}
              />
              <button
                type="button"
                className="btn-ghost shrink-0 disabled:opacity-50"
                disabled={!swapTarget || busy}
                onClick={doSwap}
              >
                Swap
              </button>
            </div>
          </Card>
        </>
      )}

      <Toast message={toast} tone="good" onDismiss={() => setToast('')} />
    </div>
  );
}
