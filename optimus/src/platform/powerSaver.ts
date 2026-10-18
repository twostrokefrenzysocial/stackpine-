import { useLowPowerMode } from 'expo-battery';

/** True when Android Power saving mode is on (the brain halves its points, caps at 30fps). */
export function usePowerSaver(): boolean {
  return useLowPowerMode();
}
