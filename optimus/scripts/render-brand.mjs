// Renders the original Optimus emblem into the app icon, adaptive icon layers,
// splash image, notification icon, favicon and widget preview.
//
//   PLAYWRIGHT_MODULE=/path/to/playwright node scripts/render-brand.mjs
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, '..', 'assets', 'brand');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ?? 'playwright');

// Same geometry as src/ui/components/Emblem.tsx (viewBox 0 0 120 120).
const emblem = ({ steel = ['#6A7680', '#2B3238'], edge = '#3A444D', visor = '#22D3EE', mono = false } = {}) => `
  <defs><linearGradient id="em" x1="0" y1="0" x2="0.3" y2="1"><stop offset="0" stop-color="${steel[0]}"/><stop offset="1" stop-color="${steel[1]}"/></linearGradient></defs>
  <polygon points="58,8 22,28 18,74 58,112 58,86 34,66 36,38 58,26" fill="${mono ? '#fff' : 'url(#em)'}" stroke="${mono ? '#fff' : edge}" stroke-width="2"/>
  <polygon points="62,8 98,28 102,74 62,112 62,86 86,66 84,38 62,26" fill="${mono ? '#fff' : 'url(#em)'}" stroke="${mono ? '#fff' : edge}" stroke-width="2"/>
  ${mono ? '' : `<polygon points="58,30 42,40 58,46" fill="${edge}"/><polygon points="62,30 78,40 62,46" fill="${edge}"/>`}
  ${mono ? '<polygon points="36,55 84,55 81,59.5 39,59.5" fill="#fff"/>' : `<polygon points="30,52 90,52 84,62 36,62" fill="${visor}" opacity="0.35"/><polygon points="36,55 84,55 81,59.5 39,59.5" fill="${visor}"/>`}`;

const grid = (n) => Array.from({ length: n }, (_, i) => `<line x1="${(i * 1024) / n}" y1="0" x2="${(i * 1024) / n}" y2="1024" stroke="#2E363E" stroke-width="1" opacity="0.5"/><line y1="${(i * 1024) / n}" x1="0" y2="${(i * 1024) / n}" x2="1024" stroke="#2E363E" stroke-width="1" opacity="0.5"/>`).join('');

const jobs = [
  {
    file: 'icon.png',
    size: 1024,
    svg: `<rect width="1024" height="1024" fill="#0E1114"/>${grid(16)}
      <path d="M150 40 H984 V874 L874 984 H40 V150 Z" fill="none" stroke="#2E363E" stroke-width="6"/>
      <g transform="translate(152 152) scale(6)">${emblem()}</g>`,
  },
  { file: 'adaptive-foreground.png', size: 1024, transparent: true, svg: `<g transform="translate(272 272) scale(4)">${emblem()}</g>` },
  { file: 'adaptive-monochrome.png', size: 1024, transparent: true, svg: `<g transform="translate(272 272) scale(4)">${emblem({ mono: true })}</g>` },
  { file: 'splash-emblem.png', size: 512, transparent: true, svg: `<g transform="translate(16 16) scale(4)">${emblem()}</g>` },
  { file: 'notification-icon.png', size: 96, transparent: true, svg: `<g transform="translate(0 0) scale(0.8)">${emblem({ mono: true })}</g>` },
  { file: 'favicon.png', size: 64, svg: `<rect width="64" height="64" fill="#0E1114"/><g transform="translate(2 2) scale(0.5)">${emblem()}</g>` },
  {
    file: 'widget-preview.png',
    w: 540,
    h: 330,
    svg: `<rect width="540" height="330" fill="#1A1F24" stroke="#2E363E" stroke-width="2"/><path d="M0 0 H520 L540 20" fill="none" stroke="#3A444D" stroke-width="2"/>
      <g transform="translate(36 75) scale(1.5)">${emblem()}</g>
      <text x="250" y="120" font-family="sans-serif" font-size="34" font-weight="700" fill="#E8EDF1" letter-spacing="4">OPTIMUS</text>
      <text x="250" y="160" font-family="sans-serif" font-size="22" fill="#A9B4BD">Tap to talk</text>
      <rect x="250" y="190" width="240" height="84" fill="#22D3EE"/>
      <path d="M352 210h20l3 3v24l-3 3h-20l-3-3v-24zM338 236l6 12 9 6h14l9-6 6-12M362 254v10" stroke="#061114" stroke-width="5" fill="none"/>`,
  },
];

fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
const page = await browser.newPage();
for (const j of jobs) {
  const w = j.w ?? j.size;
  const h = j.h ?? j.size;
  await page.setViewportSize({ width: w, height: h });
  await page.setContent(`<html><body style="margin:0;background:transparent"><svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${j.svg}</svg></body></html>`);
  await page.screenshot({ path: path.join(out, j.file), omitBackground: !!j.transparent });
  console.log('wrote', j.file);
}
await browser.close();
