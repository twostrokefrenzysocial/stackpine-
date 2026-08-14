import { useState } from 'react';
import { api, setToken } from '../lib/api.js';

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'clear', '0', 'back'];

export default function Login({ onSignedIn }) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(value) {
    setBusy(true);
    setError('');
    try {
      const res = await api.login(value);
      setToken(res.token);
      onSignedIn();
    } catch (err) {
      setError(err.message);
      setPin('');
    } finally {
      setBusy(false);
    }
  }

  function press(key) {
    if (busy) return;
    if (key === 'clear') return setPin('');
    if (key === 'back') return setPin((p) => p.slice(0, -1));
    const next = (pin + key).slice(0, 8);
    setPin(next);
  }

  return (
    <div className="min-h-full flex flex-col items-center justify-center px-6 safe-top safe-bottom">
      <div className="w-full max-w-xs">
        <h1 className="text-2xl font-bold text-center">Academy Ready</h1>
        <p className="text-sm text-muted text-center mt-1">Enter your PIN</p>

        <div className="flex justify-center gap-2.5 my-7" aria-label={`${pin.length} digits entered`}>
          {Array.from({ length: Math.max(4, pin.length) }).map((_, i) => (
            <span
              key={i}
              className={`h-3.5 w-3.5 rounded-full border ${
                i < pin.length ? 'bg-series border-series' : 'border-white/25'
              }`}
            />
          ))}
        </div>

        {error && (
          <p className="text-sm text-critical text-center mb-4" role="alert">
            {error}
          </p>
        )}

        <div className="grid grid-cols-3 gap-2.5">
          {KEYS.map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => press(key)}
              className="btn-tap text-xl h-16"
              disabled={busy}
            >
              {key === 'clear' ? 'Clear' : key === 'back' ? '←' : key}
            </button>
          ))}
        </div>

        <button
          type="button"
          className="btn-primary w-full mt-4 disabled:opacity-50"
          disabled={pin.length < 4 || busy}
          onClick={() => submit(pin)}
        >
          {busy ? 'Checking' : 'Sign in'}
        </button>
      </div>
    </div>
  );
}
