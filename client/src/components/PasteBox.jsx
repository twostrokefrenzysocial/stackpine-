import { useState } from 'react';

/**
 * The copy and paste mechanics shared by the week builder and the single meal
 * swap: fetch a prompt, put it on the clipboard, take the reply back.
 *
 * The caller owns what the prompt is and what happens to the reply.
 */
export default function PasteBox({
  loadPrompt,
  onSubmit,
  submitLabel,
  busyLabel = 'Checking',
  placeholder,
  steps,
}) {
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [copied, setCopied] = useState(false);
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [details, setDetails] = useState([]);

  async function fetchPrompt() {
    if (prompt) return prompt;
    const text = await loadPrompt();
    setPrompt(text);
    return text;
  }

  async function copyPrompt() {
    setError('');
    try {
      const text = await fetchPrompt();
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
      await onSubmit(reply);
      setReply('');
    } catch (err) {
      setError(err.message);
      setDetails(Array.isArray(err.details) ? err.details : []);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      {steps && (
        <ol className="text-sm text-ink-2 space-y-1.5 mb-3 list-decimal list-inside">
          {steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      )}

      <button type="button" className="btn-primary w-full" onClick={copyPrompt}>
        {copied ? 'Copied' : 'Copy prompt'}
      </button>

      <button
        type="button"
        className="text-xs text-series mt-2"
        onClick={async () => {
          try {
            await fetchPrompt();
            setOpen((v) => !v);
          } catch (err) {
            setError(err.message);
          }
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
          placeholder={placeholder}
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
        {busy ? busyLabel : submitLabel}
      </button>
    </div>
  );
}
