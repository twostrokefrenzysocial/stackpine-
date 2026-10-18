import { BlendMode, BlurStyle, Canvas, PaintStyle, Picture, PointMode, Skia, StrokeCap, type SkPoint } from '@shopify/react-native-skia';
import { useIsFocused } from 'expo-router';
import { usePowerSaver } from '../../platform/powerSaver';
import { useEffect, useMemo } from 'react';
import { AppState, View, type StyleProp, type ViewStyle } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { Easing, useDerivedValue, useFrameCallback, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { buildBrain, type BrainGeometry } from '../../core/brain/geometry';
import { BRAIN_STATE_INDEX, blend, targetParams, type BrainParams, type BrainState } from '../../core/brain/state';
import { useApp } from '../AppContext';

/**
 * The Optimus avatar: a procedural 3D brain of glowing points and
 * connections (see .claude/skills/optimus-design/references/brain-avatar.md).
 * Geometry and the state machine live in src/core/brain; this file only
 * projects and draws, on the UI thread, with additive blending.
 */

interface Prepared {
  g: BrainGeometry;
  /** CSR adjacency, for pulses that walk several edges. */
  adjStart: Int32Array;
  adj: Int32Array;
}

const cache = new Map<string, Prepared>();

function prepare(surfacePoints: number, interiorPoints: number): Prepared {
  const key = `${surfacePoints}:${interiorPoints}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const g = buildBrain({ surfacePoints, interiorPoints, maxEdgeLength: surfacePoints < 1000 ? 0.32 : 0.22 });
  const deg = new Int32Array(g.count);
  for (let e = 0; e < g.edges.length; e++) deg[g.edges[e]]++;
  const adjStart = new Int32Array(g.count + 1);
  for (let i = 0; i < g.count; i++) adjStart[i + 1] = adjStart[i] + deg[i];
  const fill = adjStart.slice(0, g.count);
  const adj = new Int32Array(g.edges.length);
  for (let e = 0; e < g.edges.length; e += 2) {
    const a = g.edges[e];
    const b = g.edges[e + 1];
    adj[fill[a]++] = b;
    adj[fill[b]++] = a;
  }
  const prepared = { g, adjStart, adj };
  cache.set(key, prepared);
  return prepared;
}

const MAX_PULSES = 16;
const PULSE_LIFE = 0.55; // seconds
const PATH_STEPS = 5;
const BASE_PITCH = 0.42;

export interface BrainProps {
  size: number;
  state: BrainState;
  /** 0..1, smoothed recognizer amplitude. */
  micLevel?: SharedValue<number>;
  /** 0..1, TTS amplitude or a pulse per streamed chunk. */
  speechLevel?: SharedValue<number>;
  onPress?: () => void;
  onLongPress?: () => void;
  /** Allow drag-to-rotate (off for the small top-bar brain). */
  interactive?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}

export default function BrainImpl({ size, state, micLevel, speechLevel, onPress, onLongPress, interactive = true, style, accessibilityLabel }: BrainProps) {
  const { palette: p, reduceMotion } = useApp();
  const lowPower = usePowerSaver();
  const focused = useIsFocused();
  const small = size < 120;
  const density = (small ? 0.35 : 1) * (lowPower ? 0.5 : 1);
  const { g, adjStart, adj } = useMemo(() => prepare(Math.round(1800 * density), Math.round(260 * density)), [density]);

  const stateIndex = useSharedValue(BRAIN_STATE_INDEX[state]);
  useEffect(() => {
    stateIndex.set(BRAIN_STATE_INDEX[state]);
  }, [state, stateIndex]);

  const zeroLevel = useSharedValue(0);
  const mic = micLevel ?? zeroLevel;
  const speech = speechLevel ?? zeroLevel;
  const reduce = useSharedValue(reduceMotion);
  useEffect(() => reduce.set(reduceMotion), [reduceMotion, reduce]);

  const time = useSharedValue(0);
  const yaw = useSharedValue(-0.9);
  const dragYaw = useSharedValue(0);
  const dragPitch = useSharedValue(0);
  const params = useSharedValue<BrainParams>(targetParams(BRAIN_STATE_INDEX[state], 0, 0, 0, reduceMotion));
  const pulseClock = useSharedValue(0);
  const pulseBirth = useSharedValue<number[]>(new Array(MAX_PULSES).fill(-10));
  const sinceDraw = useSharedValue(0);
  const fpsCap = lowPower ? 1 / 30 : 0;

  const frame = useFrameCallback((info) => {
    'worklet';
    const dt = Math.min(0.05, (info.timeSincePreviousFrame ?? 16) / 1000);
    sinceDraw.value += dt;
    if (fpsCap && sinceDraw.value < fpsCap) return;
    const step = sinceDraw.value;
    sinceDraw.value = 0;
    const t = time.value + step;
    time.value = t;
    const next = blend(params.value, targetParams(stateIndex.value, t, mic.value, speech.value, reduce.value), step);
    params.value = next;
    yaw.value += ((next.rotSpeed * Math.PI) / 180) * step;
    // Spawn pulses at the current rate into a ring buffer of birth times.
    const before = Math.floor(pulseClock.value);
    pulseClock.value += next.pulseRate * step;
    const after = Math.floor(pulseClock.value);
    if (after > before) {
      pulseBirth.modify((arr) => {
        'worklet';
        for (let j = before + 1; j <= after; j++) arr[j % MAX_PULSES] = t;
        return arr;
      });
    }
  }, false);

  // Run only while visible and in the foreground.
  useEffect(() => {
    frame.setActive(focused && AppState.currentState === 'active');
    const sub = AppState.addEventListener('change', (s) => frame.setActive(focused && s === 'active'));
    return () => {
      sub.remove();
      frame.setActive(false);
    };
  }, [focused, frame]);

  const red = Skia.Color(p.red);
  const redGlow = Skia.Color(p.redGlow);
  const white = Skia.Color(p.text);
  const bloom = !lowPower;

  const picture = useDerivedValue(() => {
    const t = time.value;
    const prm = params.value;
    const n = g.count;
    const half = size / 2;
    const scale = size * 0.36;
    const wob = Math.sin(t * 0.7) * 0.05;
    const a = yaw.value + dragYaw.value - prm.facing * Math.sin(yaw.value);
    const pitch = BASE_PITCH + wob + dragPitch.value + prm.facing * 0.2;
    const cy = Math.cos(a);
    const sy = Math.sin(a);
    const cp = Math.cos(pitch);
    const sp = Math.sin(pitch);
    const px = new Float32Array(n);
    const py = new Float32Array(n);
    const pz = new Float32Array(n);
    const pos = g.positions;
    for (let i = 0; i < n; i++) {
      const x = pos[i * 3];
      const y = pos[i * 3 + 1];
      const z = pos[i * 3 + 2];
      const x1 = x * cy + z * sy;
      const z1 = -x * sy + z * cy;
      const y2 = y * cp - z1 * sp;
      const z2 = y * sp + z1 * cp;
      const f = 3.2 / (3.2 + z2);
      px[i] = half + x1 * scale * f;
      py[i] = half - y2 * scale * f;
      pz[i] = z2;
    }

    const rec = Skia.PictureRecorder();
    const c = rec.beginRecording(Skia.XYWHRect(0, 0, size, size));
    const paint = Skia.Paint();
    paint.setAntiAlias(true);
    paint.setBlendMode(BlendMode.Plus);
    paint.setStrokeCap(StrokeCap.Round);
    paint.setStyle(PaintStyle.Stroke);

    // Connections: nearly invisible until a pulse passes.
    if (!small && prm.lineOpacity > 0.02) {
      const lines: SkPoint[] = [];
      const e = g.edges;
      for (let k = 0; k < e.length; k += 2) {
        lines.push({ x: px[e[k]], y: py[e[k]] }, { x: px[e[k + 1]], y: py[e[k + 1]] });
      }
      paint.setColor(red);
      paint.setAlphaf(prm.lineOpacity);
      paint.setStrokeWidth(0.6);
      c.drawPoints(PointMode.Lines, lines, paint);
    }

    // Thinking: a cluster flashes, chosen from a time-stepped hash.
    const flashSeed = Math.floor(t * 3);
    const flashIdx = Math.floor((Math.abs(Math.sin(flashSeed * 12.9898) * 43758.5453) % 1) * n);
    const flashOn = stateIndex.value === 2 && !reduce.value;

    // Points in three depth bins (farther = smaller and dimmer) plus sparkle.
    const bins: SkPoint[][] = [[], [], []];
    const sparkles: SkPoint[] = [];
    const flashes: SkPoint[] = [];
    for (let i = 0; i < n; i++) {
      const depth = (1.25 - pz[i]) / 2.5;
      const pt = { x: px[i], y: py[i] };
      if (g.sparkle[i]) sparkles.push(pt);
      else bins[depth < 0.4 ? 0 : depth < 0.65 ? 1 : 2].push(pt);
      if (flashOn) {
        const dx = pos[i * 3] - pos[flashIdx * 3];
        const dy = pos[i * 3 + 1] - pos[flashIdx * 3 + 1];
        const dz = pos[i * 3 + 2] - pos[flashIdx * 3 + 2];
        if (dx * dx + dy * dy + dz * dz < 0.06) flashes.push(pt);
      }
    }
    const dot = Math.max(1.2, size / 150);
    const binAlpha = [0.35, 0.6, 0.9];
    for (let b = 0; b < 3; b++) {
      paint.setColor(b === 2 ? redGlow : red);
      paint.setAlphaf(Math.min(1, prm.brightness * binAlpha[b]));
      paint.setStrokeWidth(dot * (0.7 + b * 0.3));
      c.drawPoints(PointMode.Points, bins[b], paint);
    }
    paint.setColor(white);
    paint.setAlphaf(Math.min(1, 0.25 + prm.brightness * 0.6));
    paint.setStrokeWidth(dot * 1.1);
    c.drawPoints(PointMode.Points, sparkles, paint);
    if (flashes.length) {
      const fl = 1 - ((t * 3) % 1);
      paint.setColor(redGlow);
      paint.setAlphaf(fl);
      paint.setStrokeWidth(dot * 1.6);
      c.drawPoints(PointMode.Points, flashes, paint);
    }

    // Pulses: random multi-edge walks (thinking) or rays from the core (responding).
    const births = pulseBirth.value;
    const heads: SkPoint[] = [];
    const trails: SkPoint[] = [];
    for (let k = 0; k < MAX_PULSES; k++) {
      const age = t - births[k];
      if (age < 0 || age > PULSE_LIFE) continue;
      const prog = age / PULSE_LIFE;
      const seed = Math.floor(births[k] * 1000) + k * 7919;
      let node = Math.floor((Math.abs(Math.sin(seed * 78.233) * 43758.5453) % 1) * n);
      if (prm.radial > 0.5) {
        const tx = px[node];
        const ty = py[node];
        const hx = half + (tx - half) * prog;
        const hy = half + (ty - half) * prog;
        const tp = Math.max(0, prog - 0.3);
        heads.push({ x: hx, y: hy });
        trails.push({ x: half + (tx - half) * tp, y: half + (ty - half) * tp }, { x: hx, y: hy });
        continue;
      }
      // Walk PATH_STEPS edges; the head sits at prog along the path.
      const path: number[] = [node];
      for (let s = 0; s < PATH_STEPS; s++) {
        const from = adjStart[node];
        const deg = adjStart[node + 1] - from;
        if (deg <= 0) break;
        node = adj[from + (Math.floor(Math.abs(Math.sin((seed + s) * 39.425) * 1000)) % deg)];
        path.push(node);
      }
      const segs = path.length - 1;
      if (segs < 1) continue;
      const pos2 = prog * segs;
      const si = Math.min(segs - 1, Math.floor(pos2));
      const f = pos2 - si;
      const A = path[si];
      const B = path[si + 1];
      const hx = px[A] + (px[B] - px[A]) * f;
      const hy = py[A] + (py[B] - py[A]) * f;
      heads.push({ x: hx, y: hy });
      for (let s = Math.max(0, si - 1); s < si; s++) trails.push({ x: px[path[s]], y: py[path[s]] }, { x: px[path[s + 1]], y: py[path[s + 1]] });
      trails.push({ x: px[A], y: py[A] }, { x: hx, y: hy });
    }
    if (trails.length) {
      paint.setColor(red);
      paint.setAlphaf(0.75);
      paint.setStrokeWidth(Math.max(1, size / 260));
      c.drawPoints(PointMode.Lines, trails, paint);
    }
    if (heads.length) {
      paint.setColor(redGlow);
      paint.setAlphaf(1);
      paint.setStrokeWidth(dot * 2.4);
      c.drawPoints(PointMode.Points, heads, paint);
    }

    // Attention core with a soft bloom.
    const core = Skia.Paint();
    core.setAntiAlias(true);
    core.setBlendMode(BlendMode.Plus);
    core.setColor(redGlow);
    core.setAlphaf(Math.min(1, prm.core));
    if (bloom) core.setMaskFilter(Skia.MaskFilter.MakeBlur(BlurStyle.Normal, size * 0.03, true));
    c.drawCircle(half, half, size * (0.025 + prm.core * 0.03), core);
    if (bloom) {
      core.setAlphaf(Math.min(1, prm.core * 0.35));
      core.setMaskFilter(Skia.MaskFilter.MakeBlur(BlurStyle.Normal, size * 0.09, true));
      c.drawCircle(half, half, size * 0.1, core);
    }
    return rec.finishRecordingAsPicture();
  });

  const gesture = useMemo(() => {
    const ease = { duration: 600, easing: Easing.bezier(0.2, 0, 0, 1) };
    const pan = Gesture.Pan()
      .enabled(interactive)
      .onChange((e) => {
        dragYaw.set(dragYaw.get() + e.changeX / (size * 0.6));
        dragPitch.set(Math.max(-0.5, Math.min(0.5, dragPitch.get() + e.changeY / (size * 0.9))));
      })
      .onEnd(() => {
        // Keep the yaw the user dragged to; ease the tilt back.
        yaw.set(yaw.get() + dragYaw.get());
        dragYaw.set(0);
        dragPitch.set(withTiming(0, ease));
      });
    const tap = Gesture.Tap().onEnd(() => {
      if (onPress) scheduleOnRN(onPress);
    });
    const long = Gesture.LongPress()
      .minDuration(500)
      .onStart(() => {
        if (onLongPress) scheduleOnRN(onLongPress);
      });
    return Gesture.Race(pan, Gesture.Exclusive(long, tap));
  }, [interactive, size, dragYaw, dragPitch, yaw, onPress, onLongPress]);

  return (
    <GestureDetector gesture={gesture}>
      <View
        style={[{ width: size, height: size }, style]}
        accessible
        accessibilityRole={onPress ? 'button' : 'image'}
        accessibilityLabel={accessibilityLabel ?? `Optimus, ${state === 'responding' ? 'responding' : state}`}
        accessibilityHint={onPress ? 'Tap to talk. Long press for assistant settings.' : undefined}
      >
        <Canvas style={{ width: size, height: size }}>
          <Picture picture={picture} />
        </Canvas>
      </View>
    </GestureDetector>
  );
}
