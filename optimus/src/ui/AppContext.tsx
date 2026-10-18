import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { AccessibilityInfo } from 'react-native';
import type { Settings } from '../core/settings/settings';
import type { Runtime } from '../platform/runtime';
import { feedback } from './feedback';
import { palette, type Palette } from './theme';

interface AppState {
  rt: Runtime;
  settings: Settings;
  updateSettings: (patch: Partial<Settings>) => Promise<void>;
  palette: Palette;
  reduceMotion: boolean;
  /** Bumped when data changes so screens can refetch. */
  dataVersion: number;
  bump: () => void;
}

const Ctx = createContext<AppState | null>(null);

export function AppProvider({ rt, children }: { rt: Runtime; children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(rt.settings);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [dataVersion, setDataVersion] = useState(0);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion).catch(() => undefined);
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => sub.remove();
  }, []);

  useEffect(() => {
    feedback.hapticsEnabled = settings.hapticsEnabled;
    feedback.soundEnabled = settings.soundEnabled;
  }, [settings.hapticsEnabled, settings.soundEnabled]);

  useEffect(() => rt.engine.actions.subscribe(() => setDataVersion((v) => v + 1)), [rt]);

  const updateSettings = useCallback(
    async (patch: Partial<Settings>) => {
      const next = await rt.updateSettings(patch);
      setSettings({ ...next });
      setDataVersion((v) => v + 1);
    },
    [rt],
  );

  const bump = useCallback(() => setDataVersion((v) => v + 1), []);

  const value = useMemo(
    () => ({ rt, settings, updateSettings, palette, reduceMotion, dataVersion, bump }),
    [rt, settings, updateSettings, reduceMotion, dataVersion, bump],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp outside AppProvider');
  return v;
}

export function usePalette(): Palette {
  return useApp().palette;
}

/** Re-runs `load` whenever data changes; returns the latest value. */
export function useData<T>(load: () => Promise<T>, deps: unknown[] = []): { data: T | undefined; reload: () => void; loading: boolean } {
  const { dataVersion } = useApp();
  const [data, setData] = useState<T>();
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    load()
      .then((d) => alive && setData(d))
      .catch(() => undefined)
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataVersion, tick, ...deps]);
  return { data, loading, reload: () => setTick((t) => t + 1) };
}
