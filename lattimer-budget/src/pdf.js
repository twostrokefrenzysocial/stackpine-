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

const LINE = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\s+(.+?)\s+\(?-?\$?([\d,]+\.\d{2})\)?(?:\s+[\d,]+\.\d{2})?$/;

/**
 * Statement text lines → normalized rows { date, description, cents, direction }.
 * Bank statements group transactions under section headings ("Deposits and
 * Other Additions", "Banking/Debit Card Withdrawals..."), so direction comes
 * from the current section; a leading minus or parentheses forces "out".
 * Years are inferred from the statement period when dates omit them.
 */
function parsePdfLines(lines, todayIso) {
  // Find a statement-period year, e.g. "07/01/2026 to 07/31/2026".
  let periodYear = null;
  let periodMonth = null;
  for (const line of lines.slice(0, 40)) {
    const m = line.match(/(\d{1,2})\/\d{1,2}\/(\d{4})\s*(?:to|through|-|–)\s*\d{1,2}\/\d{1,2}\/\d{4}/i);
    if (m) { periodMonth = Number(m[1]); periodYear = Number(m[2]); break; }
  }
  const nowYear = Number(todayIso.slice(0, 4));
  const nowMonth = Number(todayIso.slice(5, 7));

  let direction = 'out'; // safest default for a bank statement
  const rows = [];

  for (const line of lines) {
    if (OUT_SECTION.test(line) && !LINE.test(line)) { direction = 'out'; continue; }
    if (IN_SECTION.test(line) && !LINE.test(line)) { direction = 'in'; continue; }

    const m = line.match(LINE);
    if (!m) continue;
    const mo = Number(m[1]);
    const day = Number(m[2]);
    if (mo < 1 || mo > 12 || day < 1 || day > 31) continue;

    let year;
    if (m[3]) {
      year = Number(m[3]);
      if (year < 100) year += 2000;
    } else if (periodYear !== null && periodMonth !== null) {
      // Statement spanning a year boundary: January rows on a December statement.
      year = mo < periodMonth ? periodYear + 1 : periodYear;
      if (year > nowYear) year = periodYear;
    } else {
      year = mo > nowMonth ? nowYear - 1 : nowYear;
    }

    const cents = Math.round(Number(m[5].replace(/,/g, '')) * 100);
    if (!cents) continue;
    const negative = /-\$?[\d,]+\.\d{2}\)?$/.test(line) || /\([\d,]+\.\d{2}\)$/.test(line);

    const date = `${year}-${String(mo).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    rows.push({
      date,
      description: m[4].trim().slice(0, 120),
      cents,
      direction: negative ? 'out' : direction,
    });
  }

  return { rows, format: 'pdf' };
}

module.exports = { extractLines, parsePdfLines };
