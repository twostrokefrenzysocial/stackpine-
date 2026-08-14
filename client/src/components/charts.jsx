import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ReferenceArea,
  Area,
  ComposedChart,
} from 'recharts';
import { shortDate, formatSeconds } from '../lib/format.js';

function daysBetween(fromISO, toISO) {
  const a = Date.parse(`${fromISO}T00:00:00Z`);
  const b = Date.parse(`${toISO}T00:00:00Z`);
  return Math.round((b - a) / 86400000);
}

// Palette roles. One categorical slot for the data, fixed status colors for the
// thresholds. Every threshold carries a text label, so meaning never rests on hue.
const SERIES = '#3987e5';
const GOOD = '#0ca30c';
const WARNING = '#fab219';
const GRID = '#2c2c2a';
const MUTED = '#898781';
const SURFACE = '#1a1a19';

function TooltipBox({ active, payload, label, render }) {
  if (!active || !payload?.length) return null;
  return (
    <div
      className="rounded-xl border border-white/15 px-3 py-2 text-xs shadow-lg"
      style={{ backgroundColor: SURFACE, color: '#ffffff' }}
    >
      <div className="text-[11px] mb-0.5" style={{ color: MUTED }}>
        {shortDate(label)}
      </div>
      {render(payload)}
    </div>
  );
}

function Legend({ items }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1.5 mt-3 text-[11px] text-ink-2">
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="inline-block rounded-sm"
            style={{
              width: 12,
              height: item.dashed ? 0 : 3,
              borderTop: item.dashed ? `2px dashed ${item.color}` : undefined,
              backgroundColor: item.dashed ? 'transparent' : item.color,
              opacity: item.faint ? 0.5 : 1,
            }}
          />
          {item.label}
        </li>
      ))}
    </ul>
  );
}

export function EmptyChart({ children }) {
  return (
    <div className="h-40 flex items-center justify-center text-sm text-muted text-center px-6">
      {children}
    </div>
  );
}

/**
 * Weight trend. One series, a goal reference line, and a shaded band showing
 * where the 1.5 to 2.0 lb per week window would put you.
 */
export function WeightChart({ series, goalWeight, startWeight, startDate }) {
  if (!series || series.length < 2) {
    return <EmptyChart>Log weight on two different days and the trend line starts here.</EmptyChart>;
  }

  // The band is computed per data point rather than looked up, so it lines up
  // with the weigh-ins no matter which days they land on.
  const band = series.map((row) => {
    const weeks = daysBetween(startDate, row.date) / 7;
    if (!(weeks >= 0)) return null;
    const low = Math.max(startWeight - 2.0 * weeks, goalWeight);
    const high = Math.min(startWeight - 1.5 * weeks, startWeight);
    return { low, range: Math.max(0, high - low) };
  });

  // Only carry the band keys when there is a band to draw. Null values in the
  // data would otherwise pull the y axis down to zero.
  const hasBand = band.filter(Boolean).length > 1;
  const data = series.map((row, i) => ({
    date: row.date,
    lbs: row.lbs,
    ...(hasBand ? { bandLow: band[i]?.low ?? null, bandRange: band[i]?.range ?? null } : {}),
  }));

  const values = series.map((r) => r.lbs);
  const bandLows = band.filter(Boolean).map((b) => b.low);
  const min = Math.min(...values, ...(hasBand ? bandLows : []), goalWeight) - 4;
  const max = Math.max(...values, startWeight) + 4;
  // Dense weigh-in history turns individual dots into noise.
  const showDots = series.length <= 20;

  return (
    <div>
      <ResponsiveContainer width="100%" height={210}>
        <ComposedChart data={data} margin={{ top: 10, right: 12, bottom: 4, left: 0 }}>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis
            dataKey="date"
            tickFormatter={shortDate}
            tickLine={false}
            minTickGap={28}
            stroke={GRID}
          />
          <YAxis
            domain={[Math.floor(min), Math.ceil(max)]}
            width={38}
            tickLine={false}
            stroke={GRID}
            allowDecimals={false}
            /* The band series carries gaps before the plan start date. Pin the
               axis so those gaps cannot drag the scale down to zero. */
            allowDataOverflow
          />

          {/* Target pace band, drawn behind the line. */}
          {hasBand && (
            <Area
              dataKey="bandLow"
              stackId="band"
              stroke="none"
              fill="transparent"
              isAnimationActive={false}
              activeDot={false}
            />
          )}
          {hasBand && (
            <Area
              dataKey="bandRange"
              stackId="band"
              stroke="none"
              fill={SERIES}
              fillOpacity={0.22}
              isAnimationActive={false}
              activeDot={false}
            />
          )}

          <ReferenceLine
            y={goalWeight}
            stroke={GOOD}
            strokeDasharray="5 4"
            strokeWidth={2}
            label={{
              value: `Goal ${goalWeight}`,
              position: 'insideBottomLeft',
              fill: GOOD,
              fontSize: 11,
            }}
          />

          <Line
            type="monotone"
            dataKey="lbs"
            stroke={SERIES}
            strokeWidth={2}
            dot={showDots ? { r: 4, fill: SERIES, stroke: SURFACE, strokeWidth: 2 } : false}
            activeDot={{ r: 6, fill: SERIES, stroke: SURFACE, strokeWidth: 2 }}
            isAnimationActive={false}
            connectNulls
          />

          <Tooltip
            cursor={{ stroke: MUTED, strokeWidth: 1 }}
            content={(props) => (
              <TooltipBox
                {...props}
                render={(payload) => {
                  const point = payload.find((p) => p.dataKey === 'lbs');
                  return (
                    <div className="font-semibold tabular-nums">
                      {point ? `${point.value} lbs` : 'No weigh-in'}
                    </div>
                  );
                }}
              />
            )}
          />
        </ComposedChart>
      </ResponsiveContainer>
      <Legend
        items={[
          { label: 'Weight', color: SERIES },
          { label: '1.5 to 2.0 lbs per week target', color: SERIES, faint: true },
          { label: `Goal ${goalWeight} lbs`, color: GOOD, dashed: true },
        ]}
      />
    </div>
  );
}

/**
 * One minute rep test results against the entry and exit standards.
 */
export function RepTestChart({ series, entry, exit, unitLabel }) {
  if (!series || series.length === 0) {
    return <EmptyChart>Log a one minute max test and it plots here against both standards.</EmptyChart>;
  }

  const values = series.map((r) => r.value);
  const max = Math.max(...values, exit) + 4;

  return (
    <div>
      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={series} margin={{ top: 10, right: 12, bottom: 4, left: 0 }}>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis
            dataKey="date"
            tickFormatter={shortDate}
            tickLine={false}
            minTickGap={28}
            stroke={GRID}
          />
          <YAxis
            domain={[0, Math.ceil(max)]}
            width={30}
            tickLine={false}
            stroke={GRID}
            allowDecimals={false}
          />

          <ReferenceLine
            y={entry}
            stroke={WARNING}
            strokeDasharray="5 4"
            strokeWidth={2}
            label={{
              value: `Entry ${entry}`,
              position: 'insideBottomLeft',
              fill: WARNING,
              fontSize: 11,
            }}
          />
          <ReferenceLine
            y={exit}
            stroke={GOOD}
            strokeDasharray="5 4"
            strokeWidth={2}
            label={{ value: `Exit ${exit}`, position: 'insideTopLeft', fill: GOOD, fontSize: 11 }}
          />

          <Line
            type="monotone"
            dataKey="value"
            stroke={SERIES}
            strokeWidth={2}
            dot={{ r: 4, fill: SERIES, stroke: SURFACE, strokeWidth: 2 }}
            activeDot={{ r: 6, fill: SERIES, stroke: SURFACE, strokeWidth: 2 }}
            isAnimationActive={false}
          />

          <Tooltip
            cursor={{ stroke: MUTED, strokeWidth: 1 }}
            content={(props) => (
              <TooltipBox
                {...props}
                render={(payload) => (
                  <div className="font-semibold tabular-nums">
                    {payload[0].value} {unitLabel}
                  </div>
                )}
              />
            )}
          />
        </LineChart>
      </ResponsiveContainer>
      <Legend
        items={[
          { label: 'Your test', color: SERIES },
          { label: `Entry standard ${entry}`, color: WARNING, dashed: true },
          { label: `Exit standard ${exit}`, color: GOOD, dashed: true },
        ]}
      />
    </div>
  );
}

/**
 * 1.5 mile time trials. Lower is better, so the y axis is reversed and the
 * shaded zone under the entry line is the passing region.
 */
export function RunTrialChart({ series, entrySeconds, exitSeconds }) {
  if (!series || series.length === 0) {
    return <EmptyChart>Run a 1.5 mile time trial and the result plots here against both standards.</EmptyChart>;
  }

  const values = series.map((r) => r.value);
  const min = Math.min(...values, exitSeconds) - 45;
  const max = Math.max(...values, entrySeconds) + 45;

  return (
    <div>
      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={series} margin={{ top: 10, right: 12, bottom: 4, left: 0 }}>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis
            dataKey="date"
            tickFormatter={shortDate}
            tickLine={false}
            minTickGap={28}
            stroke={GRID}
          />
          <YAxis
            domain={[Math.floor(min), Math.ceil(max)]}
            reversed
            width={44}
            tickLine={false}
            tickFormatter={formatSeconds}
            stroke={GRID}
          />

          {/* Everything at or under the entry time is a pass. */}
          <ReferenceArea y1={min} y2={entrySeconds} fill={GOOD} fillOpacity={0.08} />

          <ReferenceLine
            y={entrySeconds}
            stroke={WARNING}
            strokeDasharray="5 4"
            strokeWidth={2}
            label={{
              value: `Entry ${formatSeconds(entrySeconds)}`,
              position: 'insideTopLeft',
              fill: WARNING,
              fontSize: 11,
            }}
          />
          <ReferenceLine
            y={exitSeconds}
            stroke={GOOD}
            strokeDasharray="5 4"
            strokeWidth={2}
            label={{
              value: `Exit ${formatSeconds(exitSeconds)}`,
              position: 'insideBottomLeft',
              fill: GOOD,
              fontSize: 11,
            }}
          />

          <Line
            type="monotone"
            dataKey="value"
            stroke={SERIES}
            strokeWidth={2}
            dot={{ r: 4, fill: SERIES, stroke: SURFACE, strokeWidth: 2 }}
            activeDot={{ r: 6, fill: SERIES, stroke: SURFACE, strokeWidth: 2 }}
            isAnimationActive={false}
          />

          <Tooltip
            cursor={{ stroke: MUTED, strokeWidth: 1 }}
            content={(props) => (
              <TooltipBox
                {...props}
                render={(payload) => (
                  <div className="font-semibold tabular-nums">
                    {formatSeconds(payload[0].value)} for 1.5 miles
                  </div>
                )}
              />
            )}
          />
        </LineChart>
      </ResponsiveContainer>
      <Legend
        items={[
          { label: 'Your trial', color: SERIES },
          { label: `Entry ${formatSeconds(entrySeconds)}`, color: WARNING, dashed: true },
          { label: `Exit ${formatSeconds(exitSeconds)}`, color: GOOD, dashed: true },
        ]}
      />
      <p className="text-[11px] text-muted mt-1">Faster is higher on this chart.</p>
    </div>
  );
}

/** A plain table view of any series, so the data is never color-only. */
export function SeriesTable({ rows, valueLabel, formatValue = (v) => v }) {
  if (!rows?.length) return null;
  return (
    <details className="mt-3">
      <summary className="text-xs text-muted cursor-pointer">Show the numbers</summary>
      <table className="w-full mt-2 text-sm">
        <thead>
          <tr className="text-left text-xs text-muted">
            <th className="py-1 font-medium">Date</th>
            <th className="py-1 font-medium text-right">{valueLabel}</th>
          </tr>
        </thead>
        <tbody>
          {[...rows].reverse().map((row, i) => (
            <tr key={`${row.date}-${i}`} className="border-t border-white/5">
              <td className="py-1.5">{shortDate(row.date)}</td>
              <td className="py-1.5 text-right tabular-nums">
                {formatValue(row.value ?? row.lbs)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}
