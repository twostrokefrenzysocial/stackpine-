import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { Card, Spinner } from '../components/ui.jsx';
import { formatSeconds } from '../lib/format.js';

export default function Standards() {
  const [data, setData] = useState(null);

  useEffect(() => {
    api.standards().then(setData).catch(() => setData(null));
  }, []);

  if (!data) return <Spinner label="Loading standards" />;

  const fmt = (event, value) => (event.key === 'run_trial' ? formatSeconds(value) : value);

  return (
    <div className="space-y-3">
      <header className="px-1">
        <h1 className="text-xl font-bold">Standards</h1>
        <p className="text-xs text-muted mt-0.5">{data.cohort}</p>
      </header>

      <Card title="The two bars">
        <div className="grid grid-cols-3 gap-2 text-center">
          <div />
          <div className="text-xs text-warning font-semibold">Entry</div>
          <div className="text-xs text-good font-semibold">Exit</div>

          {data.events.map((event) => (
            <div key={event.key} className="contents">
              <div className="text-left text-sm py-2 border-t border-white/5">{event.name}</div>
              <div className="text-lg font-bold tabular-nums py-2 border-t border-white/5">
                {fmt(event, event.entry)}
              </div>
              <div className="text-lg font-bold tabular-nums py-2 border-t border-white/5">
                {fmt(event, event.exit)}
              </div>
            </div>
          ))}
        </div>
        <p className="text-xs text-muted mt-3">
          Entry is what you must hit to get in. Exit is what the academy trains you toward, and it is
          what this plan builds for.
        </p>
      </Card>

      {data.events.map((event) => (
        <Card key={event.key} title={event.name}>
          <p className="text-xs text-muted mb-2">Scored in {event.unit}.</p>
          <ul className="space-y-2">
            {event.rules.map((rule) => (
              <li key={rule} className="text-sm text-ink-2 flex gap-2">
                <span aria-hidden="true" className="text-muted">
                  ·
                </span>
                <span>{rule}</span>
              </li>
            ))}
          </ul>
        </Card>
      ))}

      <Card title="Pace reference">
        <ul className="text-sm text-ink-2 space-y-1.5">
          <li>12:25 for 1.5 miles is about 2:04 per 400 meters.</li>
          <li>12:25 for 1.5 miles is about 8:17 per mile.</li>
          <li>15:13 for 1.5 miles is about 2:32 per 400 meters, or about 10:09 per mile.</li>
        </ul>
      </Card>

      <p className="text-xs text-muted px-1">
        {data.disclaimer}{' '}
        <Link to="/disclaimer" className="text-series">
          App disclaimer
        </Link>
      </p>
    </div>
  );
}
