import { useState } from 'react';
import { api } from '../lib/api.js';
import { Card } from './ui.jsx';

/**
 * The free path to a generated week: copy the prompt, paste it into whichever
 * assistant you already pay for, paste the reply back. No API key, no metered
 * calls.
 */
export default function PastePlan({ weekStart, onSaved }) {
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [copied, setCopied] = useState(false);
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [details, setDetails] = useState([]);

  async function loadPrompt() {
    if (prompt) return prompt;
    const res = await api.mealPrompt(weekStart);
    setPrompt(res.prompt);
    return res.prompt;
  }

  async function copyPrompt() {
    setError('');
    try {
      const text = await loadPrompt();
      // The clipboard API needs a user gesture and a secure context, which a
      // button tap over HTTPS satisfies. Fall back to selecting the text.
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setError('Could not reach the clipboard. Use Show prompt below and copy it by hand.');
      setOpen(true);
    }
  }

  async function save() {
    setBusy(true);
    setError('');
    setDetails([]);
    try {
      const res = await api.importMeals(weekStart, reply);
      setReply('');
      onSaved(res.plan, 'pasted');
    } catch (err) {
      setError(err.message);
      setDetails(Array.isArray(err.details) ? err.details : []);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Build it with ChatGPT">
      <ol className="text-sm text-ink-2 space-y-1.5 mb-3 list-decimal list-inside">
        <li>Copy the prompt.</li>
        <li>Paste it into ChatGPT and send.</li>
        <li>Copy its whole reply and paste it below.</li>
      </ol>

      <button type="button" className="btn-primary w-full" onClick={copyPrompt}>
        {copied ? 'Copied' : 'Copy prompt'}
      </button>

      <button
        type="button"
        className="text-xs text-series mt-2"
        onClick={async () => {
          await loadPrompt();
          setOpen((v) => !v);
        }}
      >
        {open ? 'Hide prompt' : 'Show prompt'}
      </button>

      {open && (
        <textarea
          readOnly
          className="field mt-2 min-h-[160px] text-[11px] font-mono"
          value={prompt}
          onFocus={(e) => e.target.select()}
        />
      )}

      <div className="mt-4">
        <p className="label mb-1.5">Paste the reply here</p>
        <textarea
          className="field min-h-[120px] text-xs font-mono"
          placeholder='{ "week_start": ... }'
          value={reply}
          onChange={(e) => setReply(e.target.value)}
        />
      </div>

      {error && (
        <div className="mt-3 rounded-card border border-critical/40 bg-critical/10 p-3 text-sm">
          <p>{error}</p>
          {details.length > 0 && (
            <ul className="mt-2 space-y-1 text-xs text-ink-2">
              {details.map((d) => (
                <li key={d}>{d}</li>
              ))}
            </ul>
          )}
          <p className="text-xs text-muted mt-2">
            Ask the assistant to fix exactly that and send the whole JSON again.
          </p>
        </div>
      )}

      <button
        type="button"
        className="btn-primary w-full mt-3 disabled:opacity-50"
        disabled={busy || !reply.trim()}
        onClick={save}
      >
        {busy ? 'Checking' : 'Save this week'}
      </button>
    </Card>
  );
}
