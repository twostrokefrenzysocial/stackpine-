'use strict';

// PDF statement reading. pdfjs-dist (Mozilla's PDF.js) does the text
// extraction; the line parser below turns bank-statement text into the same
// normalized rows the CSV importer produces.

const path = require('path');

let pdfjsPromise = null;
function pdfjs() {
  if (!pdfjsPromise) pdfjsPromise = import('pdfjs-dist/legacy/build/pdf.mjs');
  return pdfjsPromise;
}

/** Extract visual lines of text from a PDF, top to bottom, page by page. */
async function extractLines(buffer) {
  const lib = await pdfjs();
  const task = lib.getDocument({
    data: new Uint8Array(buffer),
    isEvalSupported: false,
    disableFontFace: true,
    standardFontDataUrl: path.join(
      path.dirname(require.resolve('pdfjs-dist/package.json')),
      'standard_fonts/'
    ),
  });
  const doc = await task.promise;

  const lines = [];
  try {
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      // Group items by their y position (rounded) so fragments join into lines.
      const byY = new Map();
      for (const item of content.items) {
        if (!item.str || !item.str.trim()) continue;
        const y = Math.round(item.transform[5] / 2) * 2;
        if (!byY.has(y)) byY.set(y, []);
        byY.get(y).push({ x: item.transform[4], text: item.str });
      }
      const ys = [...byY.keys()].sort((a, b) => b - a); // top of page first
      for (const y of ys) {
        const line = byY.get(y)
          .sort((a, b) => a.x - b.x)
          .map((i) => i.text)
          .join(' ')
          .replace(/\s+/g, ' ')
          .trim();
        if (line) lines.push(line);
      }
    }
  } finally {
    await task.destroy();
  }
  return lines;
}

// ---------------------------------------------------------------- line parsing

const IN_SECTION = /deposit|additions|credits|money in|interest paid/i;
const OUT_SECTION = /withdrawal|purchases|debits|money out|checks|payments|fees|charges/i;

const DATE_TOKEN = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/g;
const MONEY_TOKEN = /\(?-?\$?(?:\d{1,3}(?:,\d{3})+|\d+)\.\d{2}\)?/g;

/**
 * Statement text lines → normalized rows { date, description, cents, direction }.
 *
 * Real statements are messy: amounts may sit before or after the description,
 * a running-balance column can trail the amount, a posting date is often
 * embedded mid-description, and two-column pages merge two transactions onto
 * one visual line. So instead of one strict line pattern, each line is walked
 * token by token: a transaction starts at a date token, collects text, takes
 * the FIRST money token as its amount (whatever follows is balance/reference),
 * and a new date token after money has been seen starts the next transaction.
 *
 * Direction comes from the current section heading ("Deposits and Other
 * Additions" vs "…Withdrawals and Purchases"); parentheses or a minus on the
 * amount force money-out. Years missing from dates come from the statement
 * period, e.g. "07/01/2026 to 07/31/2026".
 */
function parsePdfLines(lines, todayIso) {
  let periodYear = null;
  let periodMonth = null;
  for (const line of lines.slice(0, 60)) {
    const m = line.match(/(\d{1,2})\/\d{1,2}\/(\d{4})\s*(?:to|through|-|–)\s*\d{1,2}\/\d{1,2}\/\d{4}/i);
    if (m) { periodMonth = Number(m[1]); periodYear = Number(m[2]); break; }
  }
  const nowYear = Number(todayIso.slice(0, 4));
  const nowMonth = Number(todayIso.slice(5, 7));

  const resolveYear = (mo, explicit) => {
    if (explicit) {
      let y = Number(explicit);
      if (y < 100) y += 2000;
      return y;
    }
    if (periodYear !== null && periodMonth !== null) {
      // A December statement can carry January rows across the year boundary.
      const y = mo < periodMonth ? periodYear + 1 : periodYear;
      return y > nowYear ? periodYear : y;
    }
    return mo > nowMonth ? nowYear - 1 : nowYear;
  };

  let direction = 'out'; // the safe default for a bank statement
  const rows = [];

  for (const line of lines) {
    const hasDate = /\b\d{1,2}\/\d{1,2}\b/.test(line);
    if (!hasDate) {
      // Pure heading lines steer the direction of what follows.
      if (OUT_SECTION.test(line)) direction = 'out';
      else if (IN_SECTION.test(line)) direction = 'in';
      continue;
    }

    // Tokenize: positions of every date and every money value on the line.
    const dates = [];
    let dm;
    DATE_TOKEN.lastIndex = 0;
    while ((dm = DATE_TOKEN.exec(line))) {
      dates.push({ index: dm.index, length: dm[0].length, mo: Number(dm[1]), day: Number(dm[2]), year: dm[3] });
    }
    const moneys = [];
    let mm;
    MONEY_TOKEN.lastIndex = 0;
    while ((mm = MONEY_TOKEN.exec(line))) {
      moneys.push({ index: mm.index, length: mm[0].length, raw: mm[0] });
    }
    if (!dates.length || !moneys.length) continue;

    // Segment: starts at a date token; the next segment starts at the first
    // date token that appears AFTER this segment's money has been seen, so an
    // embedded posting date never splits a transaction in two.
    const segments = [];
    let seg = null;
    for (const d of dates) {
      if (d.mo < 1 || d.mo > 12 || d.day < 1 || d.day > 31) continue;
      const moneyInSeg = seg ? moneys.find((m2) => m2.index > seg.start.index && m2.index < d.index) : null;
      if (!seg) {
        seg = { start: d, end: line.length };
      } else if (moneyInSeg) {
        seg.end = d.index;
        segments.push(seg);
        seg = { start: d, end: line.length };
      }
      // date token with no money since the segment started: posting date, skip
    }
    if (seg) segments.push(seg);

    for (const s of segments) {
      const segMoneys = moneys.filter((m2) => m2.index >= s.start.index && m2.index < s.end);
      if (!segMoneys.length) continue;
      const amountTok = segMoneys[0];
      const cents = Math.round(Number(amountTok.raw.replace(/[$,()\s-]/g, '')) * 100);
      if (!cents) continue;
      const negative = /^\(|-/.test(amountTok.raw.replace(/^\$/, ''));

      // Description: everything in the segment except the leading date and
      // the money tokens (amount, balance, references with decimals).
      let desc = line.slice(s.start.index + s.start.length, s.end);
      for (const m2 of segMoneys) {
        desc = desc.replace(m2.raw, ' ');
      }
      // Check rows put the number before the date ("1024  07/15  250.00").
      if (s === segments[0]) {
        const prefix = line.slice(0, s.start.index).replace(MONEY_TOKEN, ' ').replace(/\s+/g, ' ').trim();
        if (prefix && prefix.length <= 20) desc = prefix + ' ' + desc;
      }
      desc = desc.replace(/\s+/g, ' ').trim().slice(0, 120);
      // Date + amount with no words is a daily-balance row, not a transaction.
      if (!desc) continue;

      const year = resolveYear(s.start.mo, s.start.year);
      rows.push({
        date: `${year}-${String(s.start.mo).padStart(2, '0')}-${String(s.start.day).padStart(2, '0')}`,
        description: desc,
        cents,
        direction: negative ? 'out' : direction,
      });
    }
  }

  return { rows, format: 'pdf' };
}

module.exports = { extractLines, parsePdfLines };
