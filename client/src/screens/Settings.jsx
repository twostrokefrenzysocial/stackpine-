import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, clearToken, setToken } from '../lib/api.js';
import { Card, ErrorNote, Field, Spinner, Toast } from '../components/ui.jsx';
import { SLOT_LABELS } from '../lib/format.js';
import {
  currentSubscription,
  disablePush,
  enablePush,
  isIOS,
  isStandalone,
  pushSupported,
} from '../lib/push.js';

const DOWS = [
  { value: 0, label: 'Sunday' },
  { value: 1, label: 'Monday' },
  { value: 2, label: 'Tuesday' },
  { value: 3, label: 'Wednesday' },
  { value: 4, label: 'Thursday' },
  { value: 5, label: 'Friday' },
  { value: 6, label: 'Saturday' },
];

export default function Settings({ onSignedOut }) {
  const [settings, setSettings] = useState(null);
  const [inclineLevels, setInclineLevels] = useState([]);
  const [allSlots, setAllSlots] = useState([]);
  const [draft, setDraft] = useState({});
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [busy, setBusy] = useState(false);
  const [pushOn, setPushOn] = useState(false);
  const [pins, setPins] = useState({ current: '', next: '' });

  const load = useCallback(async () => {
    try {
      setError('');
      const res = await api.settings();
      setSettings(res.settings);
      setDraft(res.settings);
      setInclineLevels(res.incline_levels);
      setAllSlots(res.all_meal_slots || []);
      if (pushSupported()) setPushOn(Boolean(await currentSubscription()));
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function set(key, value) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  async function save(patch) {
    setBusy(true);
    try {
      const res = await api.saveSettings(patch);
      setSettings(res.settings);
      setDraft(res.settings);
      setToast(
        res.refreshed > 0
          ? `Saved. Updated ${res.refreshed} upcoming sessions.`
          : 'Saved.'
      );
    } catch (err) {
      setToast(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function togglePush() {
    setBusy(true);
    try {
      if (pushOn) {
        await disablePush();
        setPushOn(false);
        setToast('Notifications turned off for this device.');
      } else {
        await enablePush();
        setPushOn(true);
        setToast('Notifications are on for this device.');
      }
    } catch (err) {
      setToast(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (error) return <ErrorNote onRetry={load}>{error}</ErrorNote>;
  if (!settings) return <Spinner label="Loading settings" />;

  const iosNeedsInstall = isIOS() && !isStandalone();

  return (
    <div className="space-y-3">
      <header className="px-1">
        <h1 className="text-xl font-bold">Settings</h1>
      </header>

      <Card title="Test date">
        <Field label="Date" hint="Once this is set, the countdown appears on the Today screen.">
          <input
            type="date"
            className="field"
            value={draft.test_date || ''}
            onChange={(e) => set('test_date', e.target.value)}
          />
        </Field>
        <div className="flex gap-2 mt-3">
          <button
            type="button"
            className="btn-primary flex-1 disabled:opacity-50"
            disabled={busy}
            onClick={() => save({ test_date: draft.test_date || null })}
          >
            Save date
          </button>
          {settings.test_date && (
            <button
              type="button"
              className="btn-ghost disabled:opacity-50"
              disabled={busy}
              onClick={() => save({ test_date: null })}
            >
              Clear
            </button>
          )}
        </div>
      </Card>

      <Card title="Targets">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Protein min (g)">
            <input
              type="number"
              inputMode="numeric"
              className="field tabular-nums"
              value={draft.protein_min}
              onChange={(e) => set('protein_min', Number(e.target.value))}
            />
          </Field>
          <Field label="Protein max (g)">
            <input
              type="number"
              inputMode="numeric"
              className="field tabular-nums"
              value={draft.protein_max}
              onChange={(e) => set('protein_max', Number(e.target.value))}
            />
          </Field>
          <Field label="Water (oz)">
            <input
              type="number"
              inputMode="numeric"
              className="field tabular-nums"
              value={draft.water_goal_oz}
              onChange={(e) => set('water_goal_oz', Number(e.target.value))}
            />
          </Field>
          <Field label="Water, run days (oz)">
            <input
              type="number"
              inputMode="numeric"
              className="field tabular-nums"
              value={draft.water_goal_oz_run_day}
              onChange={(e) => set('water_goal_oz_run_day', Number(e.target.value))}
            />
          </Field>
          <Field label="Goal weight (lbs)">
            <input
              type="number"
              inputMode="decimal"
              className="field tabular-nums"
              value={draft.goal_weight}
              onChange={(e) => set('goal_weight', Number(e.target.value))}
            />
          </Field>
          <Field label="Household size">
            <input
              type="number"
              inputMode="numeric"
              className="field tabular-nums"
              value={draft.household_size}
              onChange={(e) => set('household_size', Number(e.target.value))}
            />
          </Field>
        </div>
        <button
          type="button"
          className="btn-primary w-full mt-3 disabled:opacity-50"
          disabled={busy}
          onClick={() =>
            save({
              protein_min: draft.protein_min,
              protein_max: draft.protein_max,
              water_goal_oz: draft.water_goal_oz,
              water_goal_oz_run_day: draft.water_goal_oz_run_day,
              goal_weight: draft.goal_weight,
              household_size: draft.household_size,
            })
          }
        >
          Save targets
        </button>
      </Card>

      <Card title="Meal preferences">
        <div className="mb-4">
          <p className="label mb-1.5">Meals you actually eat</p>
          <p className="text-xs text-muted mb-2">
            Unchecked meals are never planned. The protein target is spread across whatever is left.
          </p>
          <div className="space-y-1">
            {allSlots.map((slot) => {
              const chosen = (draft.meal_slots || []).includes(slot);
              return (
                <label key={slot} className="flex items-center gap-3 py-2 min-h-[44px]">
                  <input
                    type="checkbox"
                    className="h-5 w-5 accent-[color:var(--series-1)]"
                    checked={chosen}
                    onChange={(e) => {
                      const next = e.target.checked
                        ? [...(draft.meal_slots || []), slot]
                        : (draft.meal_slots || []).filter((x) => x !== slot);
                      set('meal_slots', allSlots.filter((x) => next.includes(x)));
                    }}
                  />
                  <span className="text-sm">{SLOT_LABELS[slot] || slot}</span>
                </label>
              );
            })}
          </div>
        </div>

        <Field label="Preferences" hint="Foods you want to see more of, cooking style, time limits.">
          <textarea
            className="field min-h-[80px]"
            value={draft.meal_preferences || ''}
            onChange={(e) => set('meal_preferences', e.target.value)}
            placeholder="Grill a lot, air fryer, quick breakfasts"
          />
        </Field>
        <div className="mt-3">
          <Field label="Exclusions" hint="Allergies and anything you will not eat.">
            <textarea
              className="field min-h-[80px]"
              value={draft.meal_exclusions || ''}
              onChange={(e) => set('meal_exclusions', e.target.value)}
              placeholder="No shellfish, no mushrooms"
            />
          </Field>
        </div>
        <button
          type="button"
          className="btn-primary w-full mt-3 disabled:opacity-50"
          disabled={busy}
          onClick={() =>
            save({
              meal_preferences: draft.meal_preferences,
              meal_exclusions: draft.meal_exclusions,
              meal_slots: draft.meal_slots,
            })
          }
        >
          Save preferences
        </button>
      </Card>

      <Card title="Plan">
        <Field
          label="Equipment"
          hint="With no equipment the strength days become bodyweight work that gets harder as the weeks go on."
        >
          <select
            className="field"
            value={draft.equipment}
            onChange={(e) => set('equipment', e.target.value)}
          >
            <option value="none">No equipment, bodyweight only</option>
            <option value="gym">Gym or dumbbells available</option>
          </select>
        </Field>

        <div className="mt-3" />
        <Field
          label="Push-up incline"
          hint="The app advances this on its own when all five sets hit 15. Override it here if you moved sooner."
        >
          <select
            className="field"
            value={draft.pushup_incline}
            onChange={(e) => set('pushup_incline', e.target.value)}
          >
            {inclineLevels.map((level) => (
              <option key={level.key} value={level.key}>
                {level.label}
              </option>
            ))}
          </select>
        </Field>

        <div className="mt-3">
          <Field
            label="Phase override"
            hint="Leave on automatic unless you are moving faster or slower than the schedule."
          >
            <select
              className="field"
              value={draft.phase_override ?? ''}
              onChange={(e) => set('phase_override', e.target.value === '' ? null : Number(e.target.value))}
            >
              <option value="">Automatic</option>
              <option value="1">Phase 1, walk and jog intervals</option>
              <option value="2">Phase 2, build to 20 min continuous</option>
              <option value="3">Phase 3, easy runs plus intervals</option>
              <option value="4">Phase 4, tighten and extend</option>
            </select>
          </Field>
        </div>

        <button
          type="button"
          className="btn-primary w-full mt-3 disabled:opacity-50"
          disabled={busy}
          onClick={() =>
            save({
              equipment: draft.equipment,
              pushup_incline: draft.pushup_incline,
              phase_override: draft.phase_override,
            })
          }
        >
          Save plan settings
        </button>
      </Card>

      <Card title="Notifications">
        {iosNeedsInstall && (
          <p className="text-xs text-warning mb-3">
            On iPhone, add Academy Ready to the home screen with the Share button first. Push only
            works from the installed app.
          </p>
        )}

        <button
          type="button"
          className={`${pushOn ? 'btn-ghost' : 'btn-primary'} w-full disabled:opacity-50`}
          disabled={busy || !pushSupported()}
          onClick={togglePush}
        >
          {!pushSupported()
            ? 'Push is not supported in this browser'
            : pushOn
            ? 'Turn off on this device'
            : 'Turn on for this device'}
        </button>

        {pushOn && (
          <button
            type="button"
            className="text-xs text-series mt-2"
            onClick={async () => {
              try {
                const res = await api.testPush();
                setToast(`Sent to ${res.sent} device${res.sent === 1 ? '' : 's'}.`);
              } catch (err) {
                setToast(err.message);
              }
            }}
          >
            Send a test notification
          </button>
        )}

        <div className="space-y-3 mt-4">
          <Field label="Morning workout summary">
            <input
              type="time"
              className="field"
              value={draft.notify_morning}
              onChange={(e) => set('notify_morning', e.target.value)}
            />
          </Field>
          <Field label="Evening log reminder">
            <input
              type="time"
              className="field"
              value={draft.notify_evening}
              onChange={(e) => set('notify_evening', e.target.value)}
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Meal plan day">
              <select
                className="field"
                value={draft.notify_mealplan_dow}
                onChange={(e) => set('notify_mealplan_dow', Number(e.target.value))}
              >
                {DOWS.map((d) => (
                  <option key={d.value} value={d.value}>
                    {d.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Meal plan time">
              <input
                type="time"
                className="field"
                value={draft.notify_mealplan_time}
                onChange={(e) => set('notify_mealplan_time', e.target.value)}
              />
            </Field>
            <Field label="Weigh-in day">
              <select
                className="field"
                value={draft.notify_weighin_dow}
                onChange={(e) => set('notify_weighin_dow', Number(e.target.value))}
              >
                {DOWS.map((d) => (
                  <option key={d.value} value={d.value}>
                    {d.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Weigh-in time">
              <input
                type="time"
                className="field"
                value={draft.notify_weighin_time}
                onChange={(e) => set('notify_weighin_time', e.target.value)}
              />
            </Field>
          </div>

          <label className="flex items-center gap-3 py-2">
            <input
              type="checkbox"
              className="h-5 w-5 accent-[color:var(--series-1)]"
              checked={Boolean(draft.notify_trial_headsup)}
              onChange={(e) => set('notify_trial_headsup', e.target.checked ? 1 : 0)}
            />
            <span className="text-sm">Monday heads up on time trial weeks</span>
          </label>

          <label className="flex items-center gap-3 py-2">
            <input
              type="checkbox"
              className="h-5 w-5 accent-[color:var(--series-1)]"
              checked={Boolean(draft.notify_enabled)}
              onChange={(e) => set('notify_enabled', e.target.checked ? 1 : 0)}
            />
            <span className="text-sm">Send scheduled notifications</span>
          </label>
        </div>

        <button
          type="button"
          className="btn-primary w-full mt-3 disabled:opacity-50"
          disabled={busy}
          onClick={() =>
            save({
              notify_morning: draft.notify_morning,
              notify_evening: draft.notify_evening,
              notify_mealplan_dow: draft.notify_mealplan_dow,
              notify_mealplan_time: draft.notify_mealplan_time,
              notify_weighin_dow: draft.notify_weighin_dow,
              notify_weighin_time: draft.notify_weighin_time,
              notify_trial_headsup: draft.notify_trial_headsup,
              notify_enabled: draft.notify_enabled,
            })
          }
        >
          Save notification times
        </button>
      </Card>

      <Card title="PIN">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Current PIN">
            <input
              type="password"
              inputMode="numeric"
              className="field"
              value={pins.current}
              onChange={(e) => setPins((p) => ({ ...p, current: e.target.value }))}
            />
          </Field>
          <Field label="New PIN">
            <input
              type="password"
              inputMode="numeric"
              className="field"
              value={pins.next}
              onChange={(e) => setPins((p) => ({ ...p, next: e.target.value }))}
            />
          </Field>
        </div>
        <button
          type="button"
          className="btn-primary w-full mt-3 disabled:opacity-50"
          disabled={busy || pins.next.length < 4}
          onClick={async () => {
            setBusy(true);
            try {
              const res = await api.changePin(pins.current, pins.next);
              setToast('PIN changed. Other devices need to sign in again.');
              setPins({ current: '', next: '' });
              setToken(res.token);
            } catch (err) {
              setToast(err.message);
            } finally {
              setBusy(false);
            }
          }}
        >
          Change PIN
        </button>
      </Card>

      <Card title="About">
        <div className="space-y-2">
          <Link to="/standards" className="block text-sm text-series">
            Standards and test rules
          </Link>
          <Link to="/disclaimer" className="block text-sm text-series">
            Disclaimer
          </Link>
          <p className="text-xs text-muted pt-2">
            Plan started {settings.start_date} at {settings.start_weight} lbs. Timezone{' '}
            {settings.timezone}.
          </p>
        </div>
      </Card>

      <button
        type="button"
        className="btn-ghost w-full"
        onClick={async () => {
          try {
            await api.logout();
          } catch {
            // Signing out locally is enough.
          }
          clearToken();
          onSignedOut();
        }}
      >
        Sign out
      </button>

      <Toast message={toast} tone="good" onDismiss={() => setToast('')} />
    </div>
  );
}
