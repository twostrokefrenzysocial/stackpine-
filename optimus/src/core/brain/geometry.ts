/**
 * Procedural geometry for the neural brain avatar. Self-contained (no
 * imports) so it can run in tests, in scripts, and in the app.
 *
 * Two ellipsoid hemispheres (radii ~1.0 x 0.8 x 1.2) with a gap down the
 * middle, displaced by low-frequency Perlin noise for cortex folds, plus
 * interior points. Each point links to its 2–3 nearest neighbours within a
 * distance limit; those edges are the paths pulses travel.
 */

export interface BrainGeometry {
  /** xyz triples, length = 3 * count. */
  positions: Float32Array;
  /** 1 = white sparkle point, 0 = red. */
  sparkle: Uint8Array;
  /** 1 = interior point. */
  interior: Uint8Array;
  /** Pairs of point indices. */
  edges: Uint32Array;
  count: number;
  surfaceCount: number;
}

export interface BrainOptions {
  surfacePoints?: number;
  interiorPoints?: number;
  seed?: number;
  radii?: [number, number, number];
  gap?: number;
  neighbours?: number;
  maxEdgeLength?: number;
}

/** Deterministic PRNG (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Classic 3D Perlin noise in roughly [-1, 1]. */
export function perlin3(seed: number): (x: number, y: number, z: number) => number {
  const rand = rng(seed);
  const p = new Uint8Array(512);
  const perm = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [perm[i], perm[j]] = [perm[j], perm[i]];
  }
  for (let i = 0; i < 512; i++) p[i] = perm[i & 255];
  const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
  const lerp = (t: number, a: number, b: number) => a + t * (b - a);
  const grad = (h: number, x: number, y: number, z: number) => {
    const g = h & 15;
    const u = g < 8 ? x : y;
    const v = g < 4 ? y : g === 12 || g === 14 ? x : z;
    return ((g & 1) === 0 ? u : -u) + ((g & 2) === 0 ? v : -v);
  };
  return (x, y, z) => {
    const X = Math.floor(x) & 255;
    const Y = Math.floor(y) & 255;
    const Z = Math.floor(z) & 255;
    x -= Math.floor(x);
    y -= Math.floor(y);
    z -= Math.floor(z);
    const u = fade(x);
    const v = fade(y);
    const w = fade(z);
    const A = p[X] + Y;
    const AA = p[A] + Z;
    const AB = p[A + 1] + Z;
    const B = p[X + 1] + Y;
    const BA = p[B] + Z;
    const BB = p[B + 1] + Z;
    return lerp(
      w,
      lerp(v, lerp(u, grad(p[AA], x, y, z), grad(p[BA], x - 1, y, z)), lerp(u, grad(p[AB], x, y - 1, z), grad(p[BB], x - 1, y - 1, z))),
      lerp(v, lerp(u, grad(p[AA + 1], x, y, z - 1), grad(p[BA + 1], x - 1, y, z - 1)), lerp(u, grad(p[AB + 1], x, y - 1, z - 1), grad(p[BB + 1], x - 1, y - 1, z - 1))),
    );
  };
}

export function buildBrain(opts: BrainOptions = {}): BrainGeometry {
  const surface = opts.surfacePoints ?? 1800;
  const inner = opts.interiorPoints ?? 260;
  const [rx, ry, rz] = opts.radii ?? [1.0, 0.8, 1.2];
  const gap = opts.gap ?? 0.07;
  const k = opts.neighbours ?? 3;
  const maxLen = opts.maxEdgeLength ?? 0.22;
  const rand = rng(opts.seed ?? 7);
  const noise = perlin3((opts.seed ?? 7) + 101);
  const count = surface + inner;
  const positions = new Float32Array(count * 3);
  const sparkle = new Uint8Array(count);
  const interior = new Uint8Array(count);

  const place = (i: number, x: number, y: number, z: number) => {
    // Hemisphere gap: push each half away from the midline (the longitudinal fissure).
    const side = x >= 0 ? 1 : -1;
    x += side * gap;
    // Flatter underside; the frontal lobe (+z) sits lower and narrower than the occipital (-z).
    if (y < 0) y *= 0.7;
    y -= 0.12 * Math.max(0, z / rz) ** 2;
    x *= 1 - 0.1 * Math.max(0, z / rz);
    // Temporal lobes bulge down and out on each side, toward the front.
    const temporal = Math.exp(-(((z / rz - 0.15) / 0.35) ** 2)) * Math.max(0, -y / ry + 0.2);
    y -= 0.18 * temporal;
    x += side * 0.08 * temporal;
    positions[i * 3] = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = z;
  };

  let placed = 0;
  let attempts = 0;
  while (placed < surface && attempts < surface * 20) {
    attempts++;
    // Uniform direction on the sphere.
    const u = rand() * 2 - 1;
    const t = rand() * Math.PI * 2;
    const s = Math.sqrt(1 - u * u);
    const dx = s * Math.cos(t);
    const dy = u;
    const dz = s * Math.sin(t);
    // The medial wall faces the fissure; keep it sparse so the gap reads.
    if (Math.abs(dx) < 0.12 && rand() < 0.8) continue;
    // Gyri: ridged noise. Points cluster on the ridges, sulci stay darker.
    const n = noise(dx * 3.1, dy * 3.1, dz * 3.1);
    const ridge = 1 - Math.abs(n) * 2.2;
    if (ridge < 0.15 && rand() < 0.75) continue;
    const fold = n * 0.12 + noise(dx * 6.3, dy * 6.3, dz * 6.3) * 0.04;
    const r = 1 + fold;
    place(placed, dx * rx * r, dy * ry * r, dz * rz * r);
    sparkle[placed] = rand() < 0.05 ? 1 : 0;
    placed++;
  }
  for (let j = 0; j < inner; j++) {
    const i = surface + j;
    // Rejection-sample inside the ellipsoid, biased toward the core.
    let x = 0;
    let y = 0;
    let z = 0;
    do {
      x = rand() * 2 - 1;
      y = rand() * 2 - 1;
      z = rand() * 2 - 1;
    } while (x * x + y * y + z * z > 1);
    const shrink = 0.35 + rand() * 0.5;
    place(i, x * rx * shrink, y * ry * shrink, z * rz * shrink);
    interior[i] = 1;
    sparkle[i] = rand() < 0.05 ? 1 : 0;
  }

  return { positions, sparkle, interior, edges: nearestEdges(positions, count, k, maxLen), count, surfaceCount: surface };
}

/** k-nearest-neighbour edges within maxLen, via a uniform grid. Deduplicated. */
export function nearestEdges(positions: Float32Array, count: number, k: number, maxLen: number): Uint32Array {
  const cell = maxLen;
  const key = (x: number, y: number, z: number) => `${Math.floor(x / cell)},${Math.floor(y / cell)},${Math.floor(z / cell)}`;
  const grid = new Map<string, number[]>();
  for (let i = 0; i < count; i++) {
    const kk = key(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
    let list = grid.get(kk);
    if (!list) grid.set(kk, (list = []));
    list.push(i);
  }
  const seen = new Set<number>();
  const out: number[] = [];
  const max2 = maxLen * maxLen;
  for (let i = 0; i < count; i++) {
    const x = positions[i * 3];
    const y = positions[i * 3 + 1];
    const z = positions[i * 3 + 2];
    const cx = Math.floor(x / cell);
    const cy = Math.floor(y / cell);
    const cz = Math.floor(z / cell);
    const best: { j: number; d: number }[] = [];
    for (let a = -1; a <= 1; a++)
      for (let b = -1; b <= 1; b++)
        for (let c = -1; c <= 1; c++) {
          const list = grid.get(`${cx + a},${cy + b},${cz + c}`);
          if (!list) continue;
          for (const j of list) {
            if (j === i) continue;
            const dx = positions[j * 3] - x;
            const dy = positions[j * 3 + 1] - y;
            const dz = positions[j * 3 + 2] - z;
            const d = dx * dx + dy * dy + dz * dz;
            if (d > max2) continue;
            if (best.length < k) best.push({ j, d });
            else {
              let worst = 0;
              for (let q = 1; q < best.length; q++) if (best[q].d > best[worst].d) worst = q;
              if (d < best[worst].d) best[worst] = { j, d };
            }
          }
        }
    for (const { j } of best) {
      const lo = Math.min(i, j);
      const hi = Math.max(i, j);
      const id = lo * count + hi;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(lo, hi);
    }
  }
  return Uint32Array.from(out);
}
