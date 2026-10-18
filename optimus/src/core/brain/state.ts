/**
 * The brain avatar's state machine, independent of rendering. One state
 * plus micLevel and speechLevel (0..1) produce target parameters; the
 * renderer eases toward them over ~500ms so nothing ever snaps.
 *
 * Plain functions only, marked 'worklet' so the renderer can call them on
 * the UI thread.
 */

export type BrainState = 'idle' | 'listening' | 'thinking' | 'responding';
export const BRAIN_STATE_INDEX: Record<BrainState, number> = { idle: 0, listening: 1, thinking: 2, responding: 3 };

export interface BrainParams {
  /** Degrees per second around Y. */
  rotSpeed: number;
  /** Point opacity 0..1. */
  brightness: number;
  /** Edge opacity when no pulse is passing. */
  lineOpacity: number;
  /** Centre core intensity 0..1. */
  core: number;
  /** Pulses spawned per second. */
  pulseRate: number;
  /** 0 = pulses along random edges, 1 = radiating from the core. */
  radial: number;
  /** Extra turn toward the camera (radians), for listening. */
  facing: number;
  /** Radial ripple amplitude (model units): the surface visibly moves. */
  wave: number;
  /** Ripple speed (radians per second). */
  waveSpeed: number;
  /** Activity sweep intensity 0..1: a band of red that scans the cortex. */
  sweep: number;
  /** Orbit ring speed (radians per second) and opacity. */
  ringSpeed: number;
  ringOpacity: number;
}

export const BLEND_SECONDS = 0.5;

/** Target parameters for a state at time t (seconds). */
export function targetParams(state: number, t: number, micLevel: number, speechLevel: number, reduceMotion: boolean): BrainParams {
  'worklet';
  // Idle breathing: 0.30 → 0.45 over a 4.5s cycle.
  const breath = 0.375 + 0.075 * Math.sin((t * Math.PI * 2) / 4.5);
  let p: BrainParams;
  if (state === 1) {
    p = {
      rotSpeed: 3,
      brightness: 0.55 + micLevel * 0.45,
      lineOpacity: 0.1,
      core: 0.5 + micLevel * 0.5,
      pulseRate: micLevel * 6,
      radial: 1,
      facing: 0.35,
      wave: 0.015 + micLevel * 0.06,
      waveSpeed: 5,
      sweep: 0,
      ringSpeed: 0.25,
      ringOpacity: 0.5,
    };
  } else if (state === 2) {
    const throb = 0.8 + 0.2 * Math.sin(t * 9);
    p = { rotSpeed: 22, brightness: 0.75, lineOpacity: 0.16, core: throb, pulseRate: 12, radial: 0, facing: 0, wave: 0.045, waveSpeed: 7, sweep: 1, ringSpeed: 1.4, ringOpacity: 0.7 };
  } else if (state === 3) {
    p = {
      rotSpeed: 10,
      brightness: 0.6 + speechLevel * 0.4,
      lineOpacity: 0.12,
      core: 0.6 + speechLevel * 0.4,
      pulseRate: 3 + speechLevel * 8,
      radial: 1,
      facing: 0.1,
      wave: 0.02 + speechLevel * 0.05,
      waveSpeed: 4,
      sweep: 0.25,
      ringSpeed: 0.6,
      ringOpacity: 0.55,
    };
  } else {
    p = { rotSpeed: 6, brightness: breath + 0.15, lineOpacity: 0.07, core: 0.18, pulseRate: 0.6, radial: 0, facing: 0, wave: 0.012, waveSpeed: 1.6, sweep: 0, ringSpeed: 0.12, ringOpacity: 0.35 };
  }
  if (reduceMotion) {
    p.rotSpeed *= 0.25;
    p.pulseRate = 0;
    p.wave = 0;
    p.ringSpeed *= 0.25;
  }
  return p;
}

/** Exponential approach: ~95% of the way in BLEND_SECONDS. */
export function blend(current: BrainParams, target: BrainParams, dt: number): BrainParams {
  'worklet';
  const a = 1 - Math.exp((-3 * dt) / BLEND_SECONDS);
  const mix = (c: number, t: number) => c + (t - c) * a;
  return {
    rotSpeed: mix(current.rotSpeed, target.rotSpeed),
    brightness: mix(current.brightness, target.brightness),
    lineOpacity: mix(current.lineOpacity, target.lineOpacity),
    core: mix(current.core, target.core),
    pulseRate: mix(current.pulseRate, target.pulseRate),
    radial: mix(current.radial, target.radial),
    facing: mix(current.facing, target.facing),
    wave: mix(current.wave, target.wave),
    waveSpeed: mix(current.waveSpeed, target.waveSpeed),
    sweep: mix(current.sweep, target.sweep),
    ringSpeed: mix(current.ringSpeed, target.ringSpeed),
    ringOpacity: mix(current.ringOpacity, target.ringOpacity),
  };
}

/** Status-strip label for each state. */
export const STATUS_LABEL: Record<BrainState, string> = {
  idle: 'READY',
  listening: 'LISTENING',
  thinking: 'PROCESSING',
  responding: 'RESPONDING',
};
