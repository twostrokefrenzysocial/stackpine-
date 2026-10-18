// Renders Optimus brand assets from the same procedural brain the app uses
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

// Runs in the page: draws the brain into a canvas with additive blending.
const draw = `
function drawBrain(ctx, cx, cy, scale, opts) {
  const { positions, sparkle, edges, count } = window.BRAIN;
  const yaw = opts.yaw ?? -0.95, pitch = opts.pitch ?? 0.45;
  const cyw = Math.cos(yaw), syw = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
  const px = new Float32Array(count), py = new Float32Array(count), pz = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    let x = positions[i*3], y = positions[i*3+1], z = positions[i*3+2];
    const x1 = x*cyw + z*syw, z1 = -x*syw + z*cyw;
    const y2 = y*cp - z1*sp, z2 = y*sp + z1*cp;
    const f = 3.2 / (3.2 + z2);
    px[i] = cx + x1*scale*f; py[i] = cy - y2*scale*f; pz[i] = z2;
  }
  ctx.globalCompositeOperation = 'lighter';
  if (!opts.mono) {
    ctx.lineWidth = Math.max(0.6, scale/320) * (opts.dot ?? 1);
    ctx.strokeStyle = 'rgba(227,27,35,' + (opts.lines ?? 0.13) + ')';
    ctx.beginPath();
    for (let e = 0; e < edges.length; e += 2) { const a = edges[e], b = edges[e+1]; ctx.moveTo(px[a], py[a]); ctx.lineTo(px[b], py[b]); }
    ctx.stroke();
  }
  for (let i = 0; i < count; i++) {
    const depth = (1.25 - pz[i]) / 2.5; // 0 far .. 1 near
    const r = Math.max(0.6, scale/220) * (0.6 + depth*0.8) * (opts.dot ?? 1);
    const a = 0.25 + depth*0.6;
    ctx.fillStyle = opts.mono ? 'rgba(255,255,255,' + a + ')' : sparkle[i] ? 'rgba(245,245,247,' + a + ')' : (depth > 0.62 ? 'rgba(255,59,66,' + a + ')' : 'rgba(227,27,35,' + a*0.8 + ')');
    ctx.beginPath(); ctx.arc(px[i], py[i], r, 0, Math.PI*2); ctx.fill();
  }
  if (!opts.mono) {
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, scale*0.2);
    g.addColorStop(0, 'rgba(255,59,66,0.95)'); g.addColorStop(0.25, 'rgba(227,27,35,0.45)'); g.addColorStop(1, 'rgba(90,10,14,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, scale*0.2, 0, Math.PI*2); ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';
}`;

const jobs = [
  { file: 'icon.png', w: 1024, h: 1024, bg: '#000000', paint: 'drawBrain(ctx, 512, 520, 330, { dot: 2.2, lines: 0.22 })' },
  { file: 'adaptive-foreground.png', w: 1024, h: 1024, paint: 'drawBrain(ctx, 512, 520, 240, { dot: 2.4, lines: 0.24 })' },
  { file: 'adaptive-monochrome.png', w: 1024, h: 1024, paint: 'drawBrain(ctx, 512, 520, 240, { mono: true, dot: 2.4 })' },
  { file: 'splash-emblem.png', w: 512, h: 512, paint: 'drawBrain(ctx, 256, 260, 170, {})' },
  { file: 'notification-icon.png', w: 96, h: 96, paint: 'drawBrain(ctx, 48, 50, 34, { mono: true, dot: 2.5 })' },
  { file: 'favicon.png', w: 64, h: 64, bg: '#000000', paint: 'drawBrain(ctx, 32, 33, 22, { dot: 2.5, lines: 0.3 })' },
  {
    file: 'widget-preview.png',
    w: 540,
    h: 330,
    bg: '#0B0B0C',
    paint: `drawBrain(ctx, 135, 165, 95, {});
      ctx.strokeStyle = '#26262A'; ctx.lineWidth = 2; ctx.strokeRect(1, 1, 538, 328);
      ctx.fillStyle = '#F5F5F7'; ctx.font = '600 30px sans-serif'; ctx.fillText('OPTIMUS', 270, 120);
      ctx.fillStyle = '#A1A1A6'; ctx.font = '20px monospace'; ctx.fillText('READY', 270, 156);
      ctx.fillStyle = '#E31B23'; ctx.fillRect(270, 196, 230, 76);
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
