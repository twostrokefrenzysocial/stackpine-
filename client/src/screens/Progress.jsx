import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { Card, ErrorNote, Spinner, StatusChip } from '../components/ui.jsx';
import { RepTestChart, RunTrialChart, SeriesTable, WeightChart } from '../components/charts.jsx';
import { formatSeconds, longDate, statusWord } from '../lib/format.js';

function ReadinessRow({ event }) {
  const isRun = event.key === 'run_trial';
  const fmt = (v) => (v === null ? 'No test yet' : isRun ? formatSeconds(v) : `${v}`);
  return (
    <li className="py-3 border-b border-white/5 last:border-0">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium">{event.name}</p>
          <p className="text-xs text-muted mt-0.5">
            Entry {fmt(event.entry)} · exit {fmt(event.exit)}
          </p>
        </div>
        <StatusChip status={event.status} />
      </div>
      <div className="flex items-baseline gap-3 mt-2">
        <span className="text-2xl font-bold tabular-nums">{fmt(event.latest)}</span>
        {event.latest_date && (
          <span className="text-xs text-muted">tested {longDate(event.latest_date)}</span>
        )}
      </div>
      {event.status === 'red' && event.gap_to_entry > 0 && (
        <p className="text-xs text-critical mt-1">
          {isRun
            ? `${formatSeconds(event.gap_to_entry)} faster to reach the entry standard.`
            : `${event.gap_to_entry} more reps to reach the entry standard.`}
        </p>
      )}
      {event.status === 'yellow' && (
        <p className="text-xs text-warning mt-1">
          Passing entry. {isRun ? 'Keep cutting toward 12:25.' : `Keep building toward ${event.exit}.`}
        </p>
      )}
    </li>
  );
}

export default function Progress() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setError('');
      setData(await api.progress());
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (error) return <ErrorNote onRetry={load}>{error}</ErrorNote>;
  if (!data) return <Spinner label="Loading progress" />;

  const { weight, standards, tests, readiness, countdown } = data;
  const situp = standards.events.find((e) => e.key === 'situp');
  const pushup = standards.events.find((e) => e.key === 'pushup');
  const run = standards.events.find((e) => e.key === 'run_trial');

  return (
    <div className="space-y-3">
      <header className="px-1">
        <h1 className="text-xl font-bold">Progress</h1>
        <p className="text-xs text-muted mt-0.5">
          {standards.cohort}
          {countdown ? ` · ${countdown.days} days to the test` : ''}
        </p>
      </header>

      <Card title="Pass readiness">
        <ul>
          {readiness.map((event) => (
            <ReadinessRow key={event.key} event={event} />
          ))}
        </ul>
      </Card>

      <Card title="Weight">
        <div className="flex items-baseline gap-3 mb-3">
          <span className="text-3xl font-bold tabular-nums">{weight.current_weight}</span>
          <span className="text-sm text-muted">
            lbs · {weight.lost.toFixed(1)} down, {weight.remaining.toFixed(1)} to go
          </span>
        </div>
        <WeightChart
          series={data.weight_series}
          goalWeight={weight.goal_weight}
          startWeight={weight.start_weight}
          startDate={weight.start_date}
        />
        <SeriesTable
          rows={data.weight_series}
          valueLabel="Weight (lbs)"
          formatValue={(v) => v}
        />
        {data.flags.length > 0 && (
          <ul className="mt-3 space-y-2">
            {data.flags.map((flag) => (
              <li key={flag.key} className="text-xs text-ink-2">
                <span className="font-semibold">{flag.title}.</span> {flag.body}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="One minute push-ups">
        <RepTestChart
          series={tests.pushup}
          entry={pushup.entry}
          exit={pushup.exit}
          unitLabel="reps"
        />
        <SeriesTable rows={tests.pushup} valueLabel="Reps" />
      </Card>

      <Card title="One minute sit-ups">
        <RepTestChart
          series={tests.situp}
          entry={situp.entry}
          exit={situp.exit}
          unitLabel="reps"
        />
        <SeriesTable rows={tests.situp} valueLabel="Reps" />
      </Card>

      <Card title="1.5 mile time trials">
        <RunTrialChart
          series={tests.run_trial}
          entrySeconds={run.entry}
          exitSeconds={run.exit}
        />
        <SeriesTable rows={tests.run_trial} valueLabel="Time" formatValue={formatSeconds} />
      </Card>

      <Card title="Weekly averages">
        {data.weekly_averages.length === 0 ? (
          <p className="text-sm text-muted">Weekly averages appear once you have a few weigh-ins.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted">
                <th className="py-1 font-medium">Week of</th>
                <th className="py-1 font-medium text-right">Average</th>
                <th className="py-1 font-medium text-right">Change</th>
              </tr>
            </thead>
            <tbody>
              {[...data.weekly_averages].reverse().map((row, i, arr) => {
                const prev = arr[i + 1];
                const delta = prev ? Number((prev.avg_lbs - row.avg_lbs).toFixed(1)) : null;
                return (
                  <tr key={row.week_start} className="border-t border-white/5">
                    <td className="py-1.5">{longDate(row.week_start)}</td>
                    <td className="py-1.5 text-right tabular-nums">{row.avg_lbs}</td>
                    <td className="py-1.5 text-right tabular-nums text-muted">
                      {delta === null ? '' : `${delta > 0 ? '-' : '+'}${Math.abs(delta)}`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>

      <p className="text-xs text-muted px-1">
        {readiness.every((r) => r.status === 'green')
          ? 'Every event is at the academy exit standard. Hold it there.'
          : `Readiness is judged against the entry standard first: ${readiness
              .map((r) => `${r.name.toLowerCase()} ${statusWord(r.status).toLowerCase()}`)
              .join(', ')}.`}{' '}
        <Link to="/standards" className="text-series">
          Test rules and standards
        </Link>
      </p>
    </div>
  );
}
