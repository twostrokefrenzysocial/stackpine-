import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { Card, Meter, ProgressRing, Spinner, ErrorNote, StatusChip, Toast } from '../components/ui.jsx';
import { NumberSheet } from '../components/QuickLog.jsx';
import { BLOCK_LABELS, SLOT_LABELS, longDate } from '../lib/format.js';

function BlockCard({ block, onLog }) {
  const isRest = block.block === 'rest';
  return (
    <div
      className={`rounded-card border p-3 ${
        block.completed ? 'border-good/40 bg-good/5' : 'border-white/10 bg-raised'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-wide text-muted">
            {BLOCK_LABELS[block.block] || block.block}
            {block.is_time_trial ? ' · time trial' : ''}
            {block.is_test_day ? ' · test day' : ''}
          </p>
          <h3 className="font-semibold mt-0.5">{block.title}</h3>
          <p className="text-sm text-ink-2 mt-1">{block.summary}</p>
        </div>
        {Boolean(block.completed) && (
          <span className="chip text-good border border-good/50 shrink-0" aria-label="Completed">
            <span aria-hidden="true">✓</span> Done
          </span>
        )}
      </div>

      {!isRest && (
        <button
          type="button"
          className={`${block.completed ? 'btn-ghost' : 'btn-primary'} w-full mt-3`}
          onClick={() => onLog(block)}
        >
          {block.completed ? 'Edit the log' : 'Start and log'}
        </button>
      )}
    </div>
  );
}

export default function Today() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [sheet, setSheet] = useState(null);
  const [toast, setToast] = useState('');
  const navigate = useNavigate();

  const load = useCallback(async () => {
    try {
      setError('');
      setData(await api.today());
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (error) return <ErrorNote onRetry={load}>{error}</ErrorNote>;
  if (!data) return <Spinner label="Loading today" />;

  const { totals, weight, blocks, catch_up: catchUp, meals, countdown, flags, week } = data;
  const working = blocks.filter((b) => b.block !== 'rest');
  const allDone = working.length > 0 && working.every((b) => b.completed);

  return (
    <div className="space-y-3">
      <header className="px-1">
        <div className="flex items-baseline justify-between">
          <h1 className="text-xl font-bold">{data.day_name}</h1>
          <span className="text-xs text-muted">{longDate(data.date)}</span>
        </div>
        <p className="text-xs text-muted mt-0.5">
          Week {week.week_number} · Phase {week.phase}
          {week.time_trial_week ? ' · time trial week' : ''}
        </p>
      </header>

      {countdown && (
        <Card className="!py-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="label">Test date</p>
              <p className="text-sm text-ink-2 mt-0.5">{longDate(countdown.test_date)}</p>
            </div>
            <div className="text-right">
              <p className="text-3xl font-bold tabular-nums leading-none">
                {countdown.days >= 0 ? countdown.days : 0}
              </p>
              <p className="text-xs text-muted mt-1">
                {countdown.days === 1 ? 'day out' : 'days out'}
              </p>
            </div>
          </div>
        </Card>
      )}

      {flags.map((flag) => (
        <div
          key={flag.key}
          className="rounded-card border p-3 text-sm"
          style={{
            borderColor:
              flag.level === 'warn'
                ? 'rgba(208,59,59,0.45)'
                : flag.level === 'good'
                ? 'rgba(12,163,12,0.45)'
                : 'rgba(250,178,25,0.45)',
            backgroundColor: 'rgba(255,255,255,0.03)',
          }}
        >
          <p className="font-semibold flex items-center gap-2">
            <span aria-hidden="true">
              {flag.level === 'warn' ? '✕' : flag.level === 'good' ? '✓' : '△'}
            </span>
            {flag.title}
          </p>
          <p className="text-ink-2 mt-1">{flag.body}</p>
        </div>
      ))}

      <Card>
        <div className="flex items-center gap-4">
          <ProgressRing
            percent={weight.percent}
            label={`${weight.lost.toFixed(1)}`}
            sub={`of ${weight.goal_total} lbs`}
          />
          <div className="flex-1 min-w-0">
            <p className="label">Weight</p>
            <p className="text-3xl font-bold tabular-nums leading-tight">
              {weight.current_weight}
              <span className="text-base font-medium text-muted"> lbs</span>
            </p>
            <p className="text-xs text-muted mt-1">
              {weight.remaining.toFixed(1)} lbs to {weight.goal_weight}
            </p>
            {weight.trend && (
              <p className="text-xs text-ink-2 mt-1.5 tabular-nums">
                7 day trend: {weight.trend.lbs_per_week} lbs per week
              </p>
            )}
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-3 gap-2">
        <button
          type="button"
          className="btn-tap flex-col gap-0.5 py-3"
          onClick={() => setSheet('weight')}
        >
          <span className="text-xs text-muted">Weight</span>
          <span className="text-lg tabular-nums">
            {totals.weight_lbs ? totals.weight_lbs : 'Log'}
          </span>
        </button>
        <button
          type="button"
          className="btn-tap flex-col gap-0.5 py-3"
          onClick={() => setSheet('water')}
        >
          <span className="text-xs text-muted">Water</span>
          <span className="text-lg tabular-nums">{Math.round(totals.water_oz)} oz</span>
        </button>
        <button
          type="button"
          className="btn-tap flex-col gap-0.5 py-3"
          onClick={() => setSheet('protein')}
        >
          <span className="text-xs text-muted">Protein</span>
          <span className="text-lg tabular-nums">{Math.round(totals.protein_g)} g</span>
        </button>
      </div>

      <Card title="Daily targets">
        <div className="space-y-4">
          <div>
            <p className="text-xs text-muted mb-1">
              Protein, {totals.protein_min} to {totals.protein_max} g
            </p>
            <Meter
              value={totals.protein_g}
              goal={totals.protein_min}
              unit="g"
              tone={totals.protein_g >= totals.protein_min ? 'good' : 'series'}
            />
          </div>
          <div>
            <p className="text-xs text-muted mb-1">
              Water{totals.run_day ? ', run day target' : ''}
            </p>
            <Meter
              value={totals.water_oz}
              goal={totals.water_goal_oz}
              unit="oz"
              tone={totals.water_oz >= totals.water_goal_oz ? 'good' : 'series'}
            />
          </div>
        </div>
      </Card>

      {catchUp && (
        <Card title="Catch up">
          <p className="text-sm text-ink-2">{catchUp.suggestion}</p>
          <ul className="mt-2 space-y-1 text-sm">
            {catchUp.missed.map((m) => (
              <li key={m.id} className="text-muted">
                {catchUp.day_name}: {m.title}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card
        title="Today's training"
        action={
          allDone ? (
            <span className="chip text-good border border-good/50">
              <span aria-hidden="true">✓</span> Week on track
            </span>
          ) : null
        }
      >
        {blocks.length === 0 ? (
          <p className="text-sm text-muted">
            {data.plan_started
              ? 'Nothing scheduled for today.'
              : `The plan starts ${longDate(week.week_start)}. Rest up.`}
          </p>
        ) : (
          <div className="space-y-2">
            {blocks.map((block) => (
              <BlockCard
                key={block.id}
                block={block}
                onLog={(b) => navigate(`/log?date=${b.date}&block=${b.id}`)}
              />
            ))}
          </div>
        )}
      </Card>

      <Card
        title="Today's meals"
        action={
          <Link to="/meals" className="text-xs text-series">
            Full week
          </Link>
        }
      >
        {meals ? (
          <>
            <ul className="space-y-2">
              {meals.meals.map((meal) => (
                <li key={meal.slot} className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[11px] uppercase tracking-wide text-muted">
                      {SLOT_LABELS[meal.slot] || meal.slot}
                    </p>
                    <p className="text-sm">{meal.name}</p>
                  </div>
                  <span className="text-sm text-ink-2 tabular-nums shrink-0">
                    {meal.protein_g} g
                  </span>
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted mt-3 tabular-nums">
              Day total {meals.total_protein_g} g protein
            </p>
          </>
        ) : (
          <div>
            <p className="text-sm text-muted">No meal plan for this week yet.</p>
            <Link to="/meals" className="btn-ghost inline-flex mt-3">
              Build the week
            </Link>
          </div>
        )}
      </Card>

      <Card title="Pass readiness">
        <ul className="space-y-2">
          {data.readiness.map((event) => (
            <li key={event.key} className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium">{event.name}</p>
                <p className="text-xs text-muted">
                  Entry {event.key === 'run_trial' ? '15:13' : event.entry} · exit{' '}
                  {event.key === 'run_trial' ? '12:25' : event.exit}
                </p>
              </div>
              <StatusChip status={event.status} />
            </li>
          ))}
        </ul>
        <Link to="/standards" className="block text-xs text-series mt-3">
          Read the test rules
        </Link>
      </Card>

      <NumberSheet
        open={sheet === 'weight'}
        title="Log weight"
        unit="pounds"
        step={0.2}
        allowDecimal
        initial={totals.weight_lbs || weight.current_weight}
        hint="Same scale, same time of day, before you eat."
        onSave={async (lbs) => {
          await api.logWeight(lbs, data.date);
          setToast('Weight saved.');
          load();
        }}
        onClose={() => setSheet(null)}
      />

      <NumberSheet
        open={sheet === 'water'}
        title="Add water"
        unit="ounces to add"
        step={4}
        initial={16}
        presets={[
          { label: '+8 oz', value: 8 },
          { label: '+16 oz', value: 16 },
          { label: '+24 oz', value: 24 },
        ]}
        hint={`Target today is ${totals.water_goal_oz} oz.`}
        onSave={async (oz) => {
          await api.logWater(oz, data.date);
          setToast('Water added.');
          load();
        }}
        onClose={() => setSheet(null)}
      />

      <NumberSheet
        open={sheet === 'protein'}
        title="Add protein"
        unit="grams to add"
        step={5}
        initial={30}
        presets={[
          { label: '+20 g', value: 20 },
          { label: '+30 g', value: 30 },
          { label: '+45 g', value: 45 },
        ]}
        hint={`Target is ${totals.protein_min} to ${totals.protein_max} g per day.`}
        onSave={async (grams) => {
          await api.logProtein(grams, data.date);
          setToast('Protein added.');
          load();
        }}
        onClose={() => setSheet(null)}
      />

      <Toast message={toast} tone="good" onDismiss={() => setToast('')} />
    </div>
  );
}
