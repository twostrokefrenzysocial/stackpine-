import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { Card, ErrorNote, Spinner, Toast } from '../components/ui.jsx';
import { SLOT_LABELS, addDays, longDate, shortDate, todayISO } from '../lib/format.js';
import PastePlan from '../components/PastePlan.jsx';

function mondayOf(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const day = dt.getUTCDay();
  return addDays(iso, day === 0 ? -6 : -(day - 1));
}

function MealRow({ meal, onSwap, swapping }) {
  return (
    <li className="py-2.5 border-b border-white/5 last:border-0">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] uppercase tracking-wide text-muted">
            {SLOT_LABELS[meal.slot] || meal.slot}
          </p>
          <p className="text-sm mt-0.5">{meal.name}</p>
          {meal.notes && <p className="text-xs text-muted mt-1">{meal.notes}</p>}
        </div>
        <div className="text-right shrink-0">
          <p className="text-sm font-semibold tabular-nums">{meal.protein_g} g</p>
          {meal.calories ? (
            <p className="text-[11px] text-muted tabular-nums">{meal.calories} cal</p>
          ) : null}
        </div>
      </div>
      <button
        type="button"
        className="text-xs text-series mt-1.5 disabled:opacity-50"
        onClick={onSwap}
        disabled={swapping}
      >
        {swapping ? 'Swapping' : 'Swap this meal'}
      </button>
    </li>
  );
}

export default function Meals() {
  const [weekStart, setWeekStart] = useState(() => mondayOf(todayISO()));
  const [plan, setPlan] = useState(null);
  const [source, setSource] = useState(null);
  const [grocery, setGrocery] = useState(null);
  const [tab, setTab] = useState('plan');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [swapping, setSwapping] = useState('');
  const [toast, setToast] = useState('');
  const [apiKeyConfigured, setApiKeyConfigured] = useState(true);

  const load = useCallback(async () => {
    try {
      setError('');
      const [planRes, groceryRes] = await Promise.all([
        api.mealPlan(weekStart),
        api.grocery(weekStart),
      ]);
      setPlan(planRes.plan);
      setSource(planRes.source);
      setApiKeyConfigured(planRes.api_key_configured);
      setGrocery(groceryRes);
    } catch (err) {
      setError(err.message);
    }
  }, [weekStart]);

  useEffect(() => {
    load();
  }, [load]);

  async function generate(force) {
    setBusy(true);
    setToast('');
    try {
      const res = await api.generateMeals(weekStart, force);
      setPlan(res.plan);
      setSource(res.source);
      setToast(
        res.source === 'fallback'
          ? `Used the built in fallback week. ${res.reason || ''}`.trim()
          : 'Week generated.'
      );
      setGrocery(await api.grocery(weekStart));
    } catch (err) {
      setToast(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function swapMeal(dayIndex, slot) {
    setSwapping(`${dayIndex}-${slot}`);
    try {
      const res = await api.swapMeal(weekStart, dayIndex, slot);
      setPlan(res.plan);
      setGrocery(await api.grocery(weekStart));
      setToast(`Swapped in: ${res.replaced.name}`);
    } catch (err) {
      setToast(err.message);
    } finally {
      setSwapping('');
    }
  }

  async function toggleItem(item) {
    const next = item.checked ? 0 : 1;
    setGrocery((g) => ({
      ...g,
      remaining: g.remaining + (next ? -1 : 1),
      sections: g.sections.map((s) => ({
        ...s,
        items: s.items.map((i) => (i.id === item.id ? { ...i, checked: next } : i)),
      })),
    }));
    try {
      await api.checkGrocery(item.id, next);
    } catch (err) {
      setToast(err.message);
      load();
    }
  }

  if (error) return <ErrorNote onRetry={load}>{error}</ErrorNote>;

  return (
    <div className="space-y-3">
      <header className="px-1">
        <h1 className="text-xl font-bold">Meals</h1>
        <p className="text-xs text-muted mt-0.5">Week of {longDate(weekStart)}</p>
      </header>

      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          className="btn-tap w-14 h-11"
          onClick={() => setWeekStart(addDays(weekStart, -7))}
          aria-label="Previous week"
        >
          ←
        </button>
        <div className="flex gap-1 rounded-xl bg-raised border border-white/10 p-1">
          {['plan', 'grocery'].map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={`px-4 py-2 rounded-lg text-sm font-medium ${
                tab === key ? 'bg-series text-white' : 'text-muted'
              }`}
            >
              {key === 'plan' ? 'Plan' : 'Grocery'}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="btn-tap w-14 h-11"
          onClick={() => setWeekStart(addDays(weekStart, 7))}
          aria-label="Next week"
        >
          →
        </button>
      </div>

      {!plan ? (
        <>
          <Card>
            <p className="text-sm text-muted">No plan for this week yet.</p>
            <button
              type="button"
              className="btn-primary w-full mt-3 disabled:opacity-50"
              disabled={busy}
              onClick={() => generate(false)}
            >
              {busy
                ? 'Building the week'
                : apiKeyConfigured
                ? 'Generate this week'
                : 'Use the built in week'}
            </button>
            {!apiKeyConfigured && (
              <p className="text-xs text-muted mt-2">
                No API key on the server, so this uses the same seven day rotation every time. For a
                fresh week, use the option below.
              </p>
            )}
          </Card>
          <PastePlan
            weekStart={weekStart}
            onSaved={async (saved, src) => {
              setPlan(saved);
              setSource(src);
              setGrocery(await api.grocery(weekStart));
              setToast('Week saved from the assistant.');
              setTab('plan');
            }}
          />
        </>
      ) : tab === 'plan' ? (
        <>
          <div className="flex items-center justify-between px-1">
            <p className="text-xs text-muted">
              {source === 'ai'
                ? 'Generated'
                : source === 'pasted'
                ? 'From your assistant'
                : source === 'mixed'
                ? 'Generated, edited'
                : 'Fallback week'}
            </p>
            <button
              type="button"
              className="text-xs text-series disabled:opacity-50"
              disabled={busy}
              onClick={() => generate(true)}
            >
              {busy ? 'Rebuilding' : 'Rebuild week'}
            </button>
          </div>

          {plan.notes && <p className="text-xs text-ink-2 px-1">{plan.notes}</p>}

          <PastePlan
            weekStart={weekStart}
            onSaved={async (saved, src) => {
              setPlan(saved);
              setSource(src);
              setGrocery(await api.grocery(weekStart));
              setToast('Week replaced from the assistant.');
            }}
          />

          {plan.days.map((day, dayIndex) => (
            <Card
              key={day.date}
              title={`${day.day_name}, ${shortDate(day.date)}`}
              action={
                <span className="text-xs text-ink-2 tabular-nums">{day.total_protein_g} g protein</span>
              }
            >
              <ul>
                {day.meals.map((meal) => (
                  <MealRow
                    key={meal.slot}
                    meal={meal}
                    swapping={swapping === `${dayIndex}-${meal.slot}`}
                    onSwap={() => swapMeal(dayIndex, meal.slot)}
                  />
                ))}
              </ul>
            </Card>
          ))}
        </>
      ) : (
        <>
          <div className="flex items-center justify-between px-1">
            <p className="text-xs text-muted">
              {grocery?.remaining ?? 0} of {grocery?.total ?? 0} left
            </p>
            <button
              type="button"
              className="text-xs text-series"
              onClick={async () => {
                await api.resetGrocery(weekStart);
                load();
              }}
            >
              Uncheck all
            </button>
          </div>

          {(grocery?.sections || []).map((section) => (
            <Card key={section.section} title={section.section}>
              <ul className="space-y-1">
                {section.items.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      className="w-full flex items-start gap-3 py-2 text-left min-h-[44px]"
                      onClick={() => toggleItem(item)}
                    >
                      <span
                        aria-hidden="true"
                        className={`mt-0.5 h-5 w-5 shrink-0 rounded border flex items-center justify-center text-xs ${
                          item.checked
                            ? 'bg-good border-good text-black'
                            : 'border-white/25 text-transparent'
                        }`}
                      >
                        ✓
                      </span>
                      <span className={item.checked ? 'text-muted line-through' : ''}>
                        {item.item}
                        {item.quantity && (
                          <span className="text-muted text-sm"> · {item.quantity}</span>
                        )}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </Card>
          ))}

          {(!grocery || grocery.total === 0) && (
            <Card>
              <p className="text-sm text-muted">
                The grocery list builds itself from the week's plan.
              </p>
            </Card>
          )}
        </>
      )}

      <Toast message={toast} tone="good" onDismiss={() => setToast('')} />
    </div>
  );
}
