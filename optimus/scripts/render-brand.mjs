// Renders Optimus brand assets (ink on white, red accents) from the same procedural brain the app uses
// (src/core/brain/geometry.ts): app icon, adaptive icon layers, splash,
// notification icon, favicon and the widget preview.
//
//   PLAYWRIGHT_MODULE=/path/to/playwright node scripts/render-brand.mjs
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildBrain } from '../src/core/brain/geometry.ts';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, '..', 'assets', 'brand');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ?? 'playwright');

const brain = buildBrain({ surfacePoints: 1600, interiorPoints: 220 });
const data = {
  positions: Array.from(brain.positions),
  sparkle: Array.from(brain.sparkle),
  edges: Array.from(brain.edges),
  count: brain.count,
};

// Runs in the page: ink points and hairlines on white, red accents, orbit rings.
const draw = `
function drawBrain(ctx, cx, cy, scale, opts) {
  const { positions, sparkle, edges, count } = window.BRAIN;
  const yaw = opts.yaw ?? -0.95, pitch = opts.pitch ?? 0.45;
  const ink = opts.ink ?? '22,24,29';
  const cyw = Math.cos(yaw), syw = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
  const px = new Float32Array(count), py = new Float32Array(count), pz = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    let x = positions[i*3], y = positions[i*3+1], z = positions[i*3+2];
    const x1 = x*cyw + z*syw, z1 = -x*syw + z*cyw;
    const y2 = y*cp - z1*sp, z2 = y*sp + z1*cp;
    const f = 3.2 / (3.2 + z2);
    px[i] = cx + x1*scale*f; py[i] = cy - y2*scale*f; pz[i] = z2;
  }
  if (opts.rings) {
    const rings = [[1.38, 0.12, 0.32], [1.48, -0.22, -0.48], [1.56, 1.15, 0.12]];
    ctx.lineWidth = Math.max(0.8, scale/260) * (opts.dot ?? 1);
    for (const [r, tx, tz] of rings) {
      for (let k = 0; k < 120; k++) {
        const pts = [k, k+1].map((q) => {
          const ang = q/120*Math.PI*2;
          let x = Math.cos(ang)*r, y = 0, z = Math.sin(ang)*r;
          const y1 = y*Math.cos(tx) - z*Math.sin(tx); z = y*Math.sin(tx) + z*Math.cos(tx); y = y1;
          const x2 = x*Math.cos(tz) - y*Math.sin(tz); y = x*Math.sin(tz) + y*Math.cos(tz); x = x2;
          const y3 = y*cp - z*sp, z3 = y*sp + z*cp, f = 6/(6+z3);
          return [cx + x*scale*f, cy - y3*scale*f, z3];
        });
        ctx.strokeStyle = 'rgba(' + ink + ',' + (pts[0][2] < 0 ? 0.5 : 0.18) + ')';
        ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]); ctx.lineTo(pts[1][0], pts[1][1]); ctx.stroke();
      }
    }
  }
  if (!opts.mono) {
    ctx.lineWidth = Math.max(0.6, scale/320) * (opts.dot ?? 1);
    ctx.strokeStyle = 'rgba(' + ink + ',' + (opts.lines ?? 0.1) + ')';
    ctx.beginPath();
    for (let e = 0; e < edges.length; e += 2) { const a = edges[e], b = edges[e+1]; ctx.moveTo(px[a], py[a]); ctx.lineTo(px[b], py[b]); }
    ctx.stroke();
  }
  for (let i = 0; i < count; i++) {
    const depth = (1.25 - pz[i]) / 2.5; // 0 far .. 1 near
    const r = Math.max(0.6, scale/220) * (0.6 + depth*0.8) * (opts.dot ?? 1);
    const a = 0.12 + depth*0.75;
    ctx.fillStyle = opts.mono ? 'rgba(255,255,255,' + Math.min(1, a + 0.2) + ')' : sparkle[i] ? 'rgba(227,25,55,' + Math.min(1, a + 0.15) + ')' : 'rgba(' + ink + ',' + a + ')';
    ctx.beginPath(); ctx.arc(px[i], py[i], r, 0, Math.PI*2); ctx.fill();
  }
  if (!opts.mono) {
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, scale*0.22);
    g.addColorStop(0, 'rgba(227,25,55,0.9)'); g.addColorStop(0.2, 'rgba(227,25,55,0.35)'); g.addColorStop(1, 'rgba(227,25,55,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, scale*0.22, 0, Math.PI*2); ctx.fill();
  }
}`;

const jobs = [
  { file: 'icon.png', w: 1024, h: 1024, bg: '#FFFFFF', paint: 'drawBrain(ctx, 512, 520, 300, { dot: 2.2, lines: 0.16, rings: true })' },
  { file: 'adaptive-foreground.png', w: 1024, h: 1024, paint: 'drawBrain(ctx, 512, 520, 210, { dot: 2.4, lines: 0.18, rings: true })' },
  { file: 'adaptive-monochrome.png', w: 1024, h: 1024, paint: 'drawBrain(ctx, 512, 520, 240, { mono: true, dot: 2.4 })' },
  { file: 'splash-emblem.png', w: 512, h: 512, paint: 'drawBrain(ctx, 256, 260, 150, { rings: true })' },
  { file: 'notification-icon.png', w: 96, h: 96, paint: 'drawBrain(ctx, 48, 50, 34, { mono: true, dot: 2.5 })' },
  { file: 'favicon.png', w: 64, h: 64, bg: '#FFFFFF', paint: 'drawBrain(ctx, 32, 33, 22, { dot: 2.5, lines: 0.25 })' },
  {
    file: 'widget-preview.png',
    w: 540,
    h: 330,
    bg: '#FFFFFF',
    paint: `drawBrain(ctx, 135, 165, 80, { rings: true });
      ctx.strokeStyle = '#E3E3E6'; ctx.lineWidth = 2; ctx.beginPath(); ctx.roundRect(1, 1, 538, 328, 24); ctx.stroke();
      ctx.fillStyle = '#16181D'; ctx.font = '300 28px sans-serif'; ctx.letterSpacing = '8px'; ctx.fillText('OPTIMUS', 270, 120);
      ctx.fillStyle = '#8D8F96'; ctx.font = '500 16px sans-serif'; ctx.letterSpacing = '3px'; ctx.fillText('READY', 270, 156);
      ctx.letterSpacing = '0px';
      ctx.fillStyle = '#16181D'; ctx.beginPath(); ctx.roundRect(270, 196, 230, 76, 38); ctx.fill();
      ctx.strokeStyle = '#FFFFFF'; ctx.lineWidth = 4; ctx.beginPath(); ctx.roundRect(373, 210, 24, 34, 12); ctx.stroke();
      ctx.beginPath(); ctx.arc(385, 238, 18, 0, Math.PI); ctx.moveTo(385, 256); ctx.lineTo(385, 264); ctx.stroke();`,
  },
];

fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
const page = await browser.newPage();
for (const j of jobs) {
  await page.setViewportSize({ width: j.w, height: j.h });
  await page.setContent(`<html><body style="margin:0;background:transparent"><canvas id="c" width="${j.w}" height="${j.h}"></canvas></body></html>`);
  await page.evaluate(
    ({ data, draw, paint, bg, w, h }) => {
      window.BRAIN = data;
      // eslint-disable-next-line no-eval
      (0, eval)(draw);
      const ctx = document.getElementById('c').getContext('2d');
      if (bg) {
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, w, h);
      }
      // eslint-disable-next-line no-new-func
      new Function('ctx', paint)(ctx);
    },
    { data, draw, paint: j.paint, bg: j.bg, w: j.w, h: j.h },
  );
  await page.locator('#c').screenshot({ path: path.join(out, j.file), omitBackground: !j.bg });
  console.log('wrote', j.file);
}
await browser.close();
