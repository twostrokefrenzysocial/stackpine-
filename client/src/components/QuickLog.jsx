import { useEffect, useRef, useState } from 'react';

export function Sheet({ open, title, onClose, children }) {
  const ref = useRef(null);

  useEffect(() => {
    if (open && ref.current) ref.current.focus();
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end" role="dialog" aria-modal="true" aria-label={title}>
      <button
        type="button"
        aria-label="Close"
        className="absolute inset-0 bg-black/60"
        onClick={onClose}
      />
      <div
        ref={ref}
        tabIndex={-1}
        className="relative w-full max-w-md mx-auto bg-surface rounded-t-3xl border-t border-x border-white/10 p-4 pb-8 outline-none safe-bottom"
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-white/20" />
        <h2 className="text-base font-semibold mb-3">{title}</h2>
        {children}
      </div>
    </div>
  );
}

/**
 * Stepper plus presets. Weight and water both land in two taps: open, then
 * tap a preset (which saves immediately).
 */
export function NumberSheet({
  open,
  title,
  unit,
  initial,
  step = 1,
  presets = [],
  onSave,
  onClose,
  hint,
  allowDecimal = false,
}) {
  const [value, setValue] = useState(initial);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) setValue(initial);
  }, [open, initial]);

  async function save(v) {
    setBusy(true);
    try {
      await onSave(Number(v));
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} title={title} onClose={onClose}>
      {presets.length > 0 && (
        <div className="grid grid-cols-3 gap-2 mb-4">
          {presets.map((p) => (
            <button
              key={p.label}
              type="button"
              className="btn-tap text-base"
              disabled={busy}
              onClick={() => save(p.value)}
            >
              {p.label}
            </button>
          ))}
        </div>
      )}

      <div className="flex items-center gap-3">
        <button
          type="button"
          className="btn-tap w-16 text-2xl"
          onClick={() => setValue((v) => Number((Number(v) - step).toFixed(1)))}
          aria-label={`Down ${step}`}
        >
          −
        </button>
        <div className="flex-1">
          <input
            type="number"
            inputMode={allowDecimal ? 'decimal' : 'numeric'}
            step={allowDecimal ? '0.1' : '1'}
            className="field text-center text-2xl font-bold tabular-nums"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
          <p className="text-center text-xs text-muted mt-1">{unit}</p>
        </div>
        <button
          type="button"
          className="btn-tap w-16 text-2xl"
          onClick={() => setValue((v) => Number((Number(v) + step).toFixed(1)))}
          aria-label={`Up ${step}`}
        >
          +
        </button>
      </div>

      {hint && <p className="text-xs text-muted mt-3">{hint}</p>}

      <button
        type="button"
        className="btn-primary w-full mt-4 disabled:opacity-50"
        disabled={busy}
        onClick={() => save(value)}
      >
        {busy ? 'Saving' : 'Save'}
      </button>
    </Sheet>
  );
}
