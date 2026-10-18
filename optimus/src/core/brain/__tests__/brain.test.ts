import { buildBrain, nearestEdges, rng } from '../geometry';
import { BLEND_SECONDS, blend, targetParams } from '../state';

describe('brain geometry', () => {
  const g = buildBrain({ seed: 7 });

  it('builds the requested points, deterministically', () => {
    expect(g.count).toBe(1800 + 260);
    expect(g.positions.length).toBe(g.count * 3);
    const again = buildBrain({ seed: 7 });
    expect(Array.from(again.positions.slice(0, 30))).toEqual(Array.from(g.positions.slice(0, 30)));
  });

  it('is brain-sized with a gap between hemispheres', () => {
    let maxX = 0;
    let maxZ = 0;
    let nearMid = 0;
    for (let i = 0; i < g.surfaceCount; i++) {
      const x = g.positions[i * 3];
      maxX = Math.max(maxX, Math.abs(x));
      maxZ = Math.max(maxZ, Math.abs(g.positions[i * 3 + 2]));
      if (Math.abs(x) < 0.05) nearMid++;
    }
    expect(maxX).toBeGreaterThan(0.9);
    expect(maxX).toBeLessThan(1.3);
    expect(maxZ).toBeGreaterThan(1.05);
    expect(nearMid).toBe(0); // nothing sits in the midline gap
  });

  it('has about 5% white sparkle points', () => {
    const n = g.sparkle.reduce((a, b) => a + b, 0);
    expect(n / g.count).toBeGreaterThan(0.03);
    expect(n / g.count).toBeLessThan(0.08);
  });

  it('links neighbours within the length limit, without duplicates', () => {
    const seen = new Set<string>();
    for (let e = 0; e < g.edges.length; e += 2) {
      const a = g.edges[e];
      const b = g.edges[e + 1];
      expect(a).toBeLessThan(b);
      const id = `${a}-${b}`;
      expect(seen.has(id)).toBe(false);
      seen.add(id);
      const d = Math.hypot(g.positions[a * 3] - g.positions[b * 3], g.positions[a * 3 + 1] - g.positions[b * 3 + 1], g.positions[a * 3 + 2] - g.positions[b * 3 + 2]);
      expect(d).toBeLessThanOrEqual(0.22 + 1e-6);
    }
    expect(g.edges.length / 2).toBeGreaterThan(g.count); // roughly 2-3 per point after dedupe
  });

  it('nearestEdges matches brute force on a small cloud', () => {
    const r = rng(3);
    const n = 120;
    const pos = Float32Array.from({ length: n * 3 }, () => r());
    const fast = new Set<string>();
    const e = nearestEdges(pos, n, 2, 0.3);
    for (let i = 0; i < e.length; i += 2) fast.add(`${e[i]}-${e[i + 1]}`);
    // Every point's single nearest neighbour (if within range) must be linked.
    for (let i = 0; i < n; i++) {
      let best = -1;
      let bd = Infinity;
      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        const d = Math.hypot(pos[i * 3] - pos[j * 3], pos[i * 3 + 1] - pos[j * 3 + 1], pos[i * 3 + 2] - pos[j * 3 + 2]);
        if (d < bd) [bd, best] = [d, j];
      }
      if (bd <= 0.3) expect(fast.has(`${Math.min(i, best)}-${Math.max(i, best)}`)).toBe(true);
    }
  });
});

describe('brain state machine', () => {
  it('idle breathes between 0.45 and 0.60, ripples gently and rotates 6°/s', () => {
    const values = Array.from({ length: 45 }, (_, i) => targetParams(0, i / 10, 0, 0, false).brightness);
    expect(Math.min(...values)).toBeCloseTo(0.45, 2);
    expect(Math.max(...values)).toBeCloseTo(0.6, 2);
    expect(targetParams(0, 0, 0, 0, false).wave).toBeGreaterThan(0);
    expect(targetParams(0, 0, 0, 0, false).sweep).toBe(0);
    expect(targetParams(0, 0, 0, 0, false).rotSpeed).toBe(6);
  });

  it('listening follows the mic, thinking spins and pulses, responding follows speech', () => {
    expect(targetParams(1, 0, 1, 0, false).brightness).toBeCloseTo(1);
    expect(targetParams(1, 0, 0, 0, false).brightness).toBeCloseTo(0.55);
    expect(targetParams(1, 0, 1, 0, false).wave).toBeGreaterThan(targetParams(1, 0, 0, 0, false).wave);
    const thinking = targetParams(2, 0, 0, 0, false);
    expect(thinking.rotSpeed).toBe(22);
    // Thinking visibly works: the surface ripples hardest and the activity band scans.
    expect(thinking.wave).toBeGreaterThan(targetParams(0, 0, 0, 0, false).wave * 3);
    expect(thinking.sweep).toBe(1);
    expect(thinking.ringSpeed).toBeGreaterThan(targetParams(0, 0, 0, 0, false).ringSpeed);
    expect(thinking.pulseRate).toBeGreaterThanOrEqual(6);
    expect(thinking.pulseRate).toBeLessThanOrEqual(12);
    expect(targetParams(3, 0, 0, 1, false).brightness).toBeCloseTo(1);
    expect(targetParams(3, 0, 0, 0, false).radial).toBe(1);
  });

  it('reduce motion slows rotation by 75% and drops pulses and ripples', () => {
    const p = targetParams(2, 0, 0, 0, true);
    expect(p.rotSpeed).toBeCloseTo(22 * 0.25);
    expect(p.pulseRate).toBe(0);
    expect(p.wave).toBe(0);
  });

  it('blends smoothly: ~95% of the way after the blend time, never overshooting', () => {
    let cur = targetParams(0, 0, 0, 0, false);
    const target = targetParams(2, 0, 0, 0, false);
    const steps = 30;
    let prev = cur.rotSpeed;
    for (let i = 0; i < steps; i++) {
      cur = blend(cur, target, BLEND_SECONDS / steps);
      expect(cur.rotSpeed).toBeGreaterThanOrEqual(prev);
      expect(cur.rotSpeed).toBeLessThanOrEqual(target.rotSpeed);
      prev = cur.rotSpeed;
    }
    expect((cur.rotSpeed - 6) / (22 - 6)).toBeGreaterThan(0.94);
  });
});
