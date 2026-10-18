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
  /** Shell point brightness 0..1. */
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
}

export const BLEND_SECONDS = 0.5;

/** Target parameters for a state at time t (seconds). */
export function targetParams(state: number, t: number, micLevel: number, speechLevel: number, reduceMotion: boolean): BrainParams {
  'worklet';
  // Idle breathing: 0.30 → 0.45 over a 4.5s cycle.
  const breath = 0.375 + 0.075 * Math.sin((t * Math.PI * 2) / 4.5);
  let p: BrainParams;
  if (state === 1) {
    p = { rotSpeed: 3, brightness: 0.4 + micLevel * 0.6, lineOpacity: 0.1, core: 0.5, pulseRate: 0, radial: 0, facing: 0.35 };
  } else if (state === 2) {
    const throb = 0.8 + 0.2 * Math.sin(t * 9);
    p = { rotSpeed: 25, brightness: 0.62, lineOpacity: 0.15, core: throb, pulseRate: 10, radial: 0, facing: 0 };
  } else if (state === 3) {
    p = { rotSpeed: 12, brightness: 0.5 + speechLevel * 0.5, lineOpacity: 0.12, core: 0.6 + speechLevel * 0.4, pulseRate: 3 + speechLevel * 8, radial: 1, facing: 0.1 };
  } else {
    p = { rotSpeed: 6, brightness: breath, lineOpacity: 0.06, core: 0.18, pulseRate: 0, radial: 0, facing: 0 };
  }
  if (reduceMotion) {
    p.rotSpeed *= 0.25;
    p.pulseRate = 0;
  }
  return p;
}

/** Exponential approach: ~95% of the way in BLEND_SECONDS. */
export function blend(current: BrainParams, target: BrainParams, dt: number): BrainParams {
  'worklet';
  const a = 1 - Math.exp((-3 * dt) / BLEND_SECONDS);
  return {
    rotSpeed: current.rotSpeed + (target.rotSpeed - current.rotSpeed) * a,
    brightness: current.brightness + (target.brightness - current.brightness) * a,
    lineOpacity: current.lineOpacity + (target.lineOpacity - current.lineOpacity) * a,
    core: current.core + (target.core - current.core) * a,
    pulseRate: current.pulseRate + (target.pulseRate - current.pulseRate) * a,
    radial: current.radial + (target.radial - current.radial) * a,
    facing: current.facing + (target.facing - current.facing) * a,
  };
}

/** Status-strip label for each state. */
export const STATUS_LABEL: Record<BrainState, string> = {
  idle: 'READY',
  listening: 'LISTENING',
  thinking: 'PROCESSING',
  responding: 'RESPONDING',
};
