import { statusColor, statusWord } from '../lib/format.js';

export function Card({ title, action, children, className = '' }) {
  return (
    <section className={`card ${className}`}>
      {(title || action) && (
        <header className="flex items-start justify-between gap-3 mb-3">
          {title && <h2 className="text-sm font-semibold text-ink-2">{title}</h2>}
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

export function Spinner({ label = 'Loading' }) {
  return (
    <div className="flex items-center gap-3 text-muted text-sm py-8 justify-center">
      <span className="h-4 w-4 rounded-full border-2 border-white/20 border-t-series animate-spin" />
      {label}
    </div>
  );
}

export function ErrorNote({ children, onRetry }) {
  if (!children) return null;
  return (
    <div className="rounded-card border border-critical/40 bg-critical/10 p-3 text-sm text-ink">
      <p>{children}</p>
      {onRetry && (
        <button type="button" onClick={onRetry} className="mt-2 underline text-ink-2">
          Try again
        </button>
      )}
    </div>
  );
}

// Status is never carried by color alone: every chip has a glyph and a word.
const STATUS_GLYPH = { green: '✓', yellow: '△', red: '✕', unknown: '-' };

export function StatusChip({ status, children }) {
  const color = statusColor(status);
  return (
    <span
      className="chip"
      style={{ color, backgroundColor: 'rgba(255,255,255,0.06)', border: `1px solid ${color}` }}
    >
      <span aria-hidden="true">{STATUS_GLYPH[status] || STATUS_GLYPH.unknown}</span>
      <span>{children || statusWord(status)}</span>
    </span>
  );
}

export function ProgressRing({ percent, size = 120, stroke = 12, label, sub }) {
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(100, percent || 0));
  const offset = circumference * (1 - clamped / 100);

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} role="img" aria-label={`${clamped} percent of the way to goal`}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--gridline)"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--series-1)"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-bold leading-none">{label}</span>
        {sub && <span className="text-xs text-muted mt-1">{sub}</span>}
      </div>
    </div>
  );
}

export function Meter({ value, goal, unit, tone = 'series' }) {
  const pct = goal > 0 ? Math.max(0, Math.min(100, (value / goal) * 100)) : 0;
  const color = tone === 'good' ? 'var(--status-good)' : 'var(--series-1)';
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="text-xl font-bold tabular-nums">
          {Math.round(value)}
          <span className="text-sm font-medium text-muted"> / {goal} {unit}</span>
        </span>
        <span className="text-xs text-muted tabular-nums">{Math.round(pct)}%</span>
      </div>
      <div className="mt-2 h-2 rounded-full bg-line overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
    </div>
  );
}

export function Toast({ message, tone = 'info', onDismiss }) {
  if (!message) return null;
  const border =
    tone === 'error' ? 'border-critical/50' : tone === 'good' ? 'border-good/50' : 'border-white/15';
  return (
    <div
      className={`fixed left-3 right-3 bottom-24 z-50 rounded-card border ${border} bg-raised p-3 text-sm shadow-lg`}
      role="status"
    >
      <div className="flex items-start gap-3">
        <p className="flex-1">{message}</p>
        <button type="button" onClick={onDismiss} className="text-muted px-1" aria-label="Dismiss">
          {'✕'}
        </button>
      </div>
    </div>
  );
}

export function Field({ label, hint, children }) {
  return (
    <label className="block">
      <span className="label block mb-1.5">{label}</span>
      {children}
      {hint && <span className="block text-xs text-muted mt-1">{hint}</span>}
    </label>
  );
}
