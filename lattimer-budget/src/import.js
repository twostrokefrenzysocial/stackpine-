'use strict';

// Bank-statement CSV parsing and merchant matching. No dependencies: banks
// export small, simple files, and a tolerant hand parser beats dragging in a
// library for it.

const crypto = require('crypto');

// ---------------------------------------------------------------- csv

/** Minimal CSV splitter that honours quoted fields and CRLF line ends. */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') inQuotes = false;
      else field += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field); field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((c) => c.trim() !== '')) rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }
  row.push(field);
  if (row.some((c) => c.trim() !== '')) rows.push(row);
  return rows;
}

// ---------------------------------------------------------------- dates & amounts

/** Accepts 8/2/2026, 08/02/26, 2026-08-02 → YYYY-MM-DD, or null. */
function parseDate(raw) {
  const s = String(raw || '').trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return iso(Number(m[1]), Number(m[2]), Number(m[3]));
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (m) {
    let year = Number(m[3]);
    if (year < 100) year += 2000;
    return iso(year, Number(m[1]), Number(m[2]));
  }
  return null;
}

function iso(y, mo, d) {
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || y < 2000 || y > 2100) return null;
  const probe = new Date(Date.UTC(y, mo - 1, d));
  if (probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d) return null;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** "$1,234.56", "(45.00)", "-45.00" → cents (negative for parens/minus), or null. */
function parseAmount(raw) {
  let s = String(raw || '').trim();
  if (!s) return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) { negative = true; s = s.slice(1, -1); }
  s = s.replace(/[$,\s]/g, '');
  if (s.startsWith('-')) { negative = true; s = s.slice(1); }
  if (s.startsWith('+')) s = s.slice(1);
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const cents = Math.round(Number(s) * 100);
  return negative ? -cents : cents;
}

// ---------------------------------------------------------------- header detection

const DATE_HEADERS = ['date', 'posted date', 'post date', 'transaction date'];
const DESC_HEADERS = ['description', 'payee', 'memo', 'name', 'transaction description'];
const AMOUNT_HEADERS = ['amount', 'transaction amount'];
const OUT_HEADERS = ['withdrawals', 'withdrawal', 'debit', 'debits', 'amount debit', 'money out'];
const IN_HEADERS = ['deposits', 'deposit', 'credit', 'credits', 'amount credit', 'money in'];

function findColumn(headers, names) {
  return headers.findIndex((h) => names.includes(h));
}

/**
 * Turns raw CSV text into normalized rows:
 *   { date, description, cents, direction: 'out' | 'in' }
 * Handles both single signed-amount columns and split withdrawal/deposit
 * columns; falls back to positional guessing when there is no header row.
 */
function parseStatement(text) {
  const rows = parseCsv(String(text || ''));
  if (!rows.length) return { rows: [], format: 'empty' };

  // Find the header row within the first few lines (banks love preambles).
  let headerIndex = -1;
  let cols = null;
  for (let i = 0; i < Math.min(rows.length, 8); i++) {
    const lower = rows[i].map((c) => c.trim().toLowerCase());
    const dateCol = findColumn(lower, DATE_HEADERS);
    if (dateCol === -1) continue;
    const descCol = findColumn(lower, DESC_HEADERS);
    const amountCol = findColumn(lower, AMOUNT_HEADERS);
    const outCol = findColumn(lower, OUT_HEADERS);
    const inCol = findColumn(lower, IN_HEADERS);
    if (descCol !== -1 && (amountCol !== -1 || outCol !== -1 || inCol !== -1)) {
      headerIndex = i;
      cols = { dateCol, descCol, amountCol, outCol, inCol };
      break;
    }
  }

  let format;
  const out = [];

  if (cols) {
    format = cols.amountCol !== -1 ? 'header-signed' : 'header-split';
    for (const row of rows.slice(headerIndex + 1)) {
      const date = parseDate(row[cols.dateCol]);
      if (!date) continue;
      const description = String(row[cols.descCol] || '').trim().slice(0, 120);
      if (cols.amountCol !== -1) {
        const cents = parseAmount(row[cols.amountCol]);
        if (cents === null || cents === 0) continue;
        out.push({ date, description, cents: Math.abs(cents), direction: cents < 0 ? 'out' : 'in' });
      } else {
        const spent = cols.outCol !== -1 ? parseAmount(row[cols.outCol]) : null;
        const received = cols.inCol !== -1 ? parseAmount(row[cols.inCol]) : null;
        if (spent) out.push({ date, description, cents: Math.abs(spent), direction: 'out' });
        if (received) out.push({ date, description, cents: Math.abs(received), direction: 'in' });
      }
    }
  } else {
    // No header: assume date, description, signed amount as the first three
    // usable columns of each row.
    format = 'positional';
    for (const row of rows) {
      const date = parseDate(row[0]);
      const cents = parseAmount(row[row.length - 1]) ?? parseAmount(row[2]);
      if (!date || cents === null || cents === 0) continue;
      const description = String(row[1] || '').trim().slice(0, 120);
      out.push({ date, description, cents: Math.abs(cents), direction: cents < 0 ? 'out' : 'in' });
    }
  }

  return { rows: out, format };
}

// ---------------------------------------------------------------- merchants

const NOISE = new Set([
  'pos', 'debit', 'credit', 'card', 'purchase', 'payment', 'ach', 'web', 'pmt',
  'recurring', 'checkcard', 'check', 'visa', 'mc', 'online', 'transfer', 'id',
  'ppd', 'des', 'co', 'ref', 'the',
]);

/** "KROGER #123 CINCINNATI OH 08/01" → "KROGER", stable across statements. */
function merchantKey(description) {
  const tokens = String(description || '')
    .toUpperCase()
    .replace(/[^A-Z ]+/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 2 && !NOISE.has(t.toLowerCase()));
  return tokens.slice(0, 2).join(' ');
}

// Keyword fallbacks tuned against the family's real statements. Patterns are
// matched against a space-normalized description (punctuation collapsed), so
// "DOLLAR-GENERAL #123" and "TST* SOME DINER" both land. Learned rules (what
// they actually picked last time) always take precedence.
const KEYWORD_GUESSES = [
  { match: /KROGER|ALDI|MEIJER|WAL ?MART|WM SUPERCENTER|SAVE ?A ?LOT|GIANT EAGLE|ACME (NO|\d|FRESH|STORE)|SAMS ?CLUB|COSTCO|CORNERSTONE MARKET|NESPRESSO|FOOD|GROCER|IGA\b/, category: 'Groceries' },
  { match: /SHELL|SPEEDWAY|MARATHON|BP\b|CIRCLE ?K|SUNOCO|EXXON|VALERO|GET ?GO|SHEETZ|CASEYS|MURPHY USA|\bARCO\b|FUEL|GAS STATION|PILOT|LOVES/, category: 'Fuel' },
  { match: /MCDONALD|WENDY|BURGER|TACO|CHIPOTLE|PIZZA|SUBWAY|CHICK ?FIL|KFC|ARBY|SONIC|DAIRY QUEEN|RESTAURANT|GRUBHUB|DOORDASH|STARBUCKS|DUNKIN|COFFEE|CAFE\b|\bTST\b|NOODLES|PANERA|FIVE GUYS|CINEMA|LOTTO|LOTTERY|BOWL|JIMMY JOHN|LITTLE CAESAR|BEILER|AKRON ZOO|TIM HORTON|FREDDY|HILTON/, category: 'Eating out & fun' },
  { match: /AUTOZONE|O ?REILLY|ADVANCE AUTO|NAPA|TIRE|JIFFY LUBE|VALVOLINE|CAR WASH|PARTS|AUTO TITLE|OH BUREAU|\bBMV\b|HOPETOWN/, category: 'Vehicle parts & maintenance' },
  { match: /DOLLAR (GENERAL|TREE)|\bDG\b|FAMILY DOLLAR|TARGET|LOWES|HOME DEPOT|MENARDS|ACE HARDWARE|CVS|WALGREENS|RITE AID|PETCO|PETSMART|CHEWY|AMAZON|AMZN|FIVE BELOW|KOHL|MICHAELS|VILLAGE DISCOUNT|HOUSEHOLD/, category: 'Household & misc' },
  { match: /ROCKET MTG|ROCKET MORTGAGE|MORTGAGE/, category: 'Mortgage (Rocket)' },
  { match: /TEL LEASE|STELLANTIS/, category: "Miriam's lease" },
  // Two Stroke Frenzy business expenses; applies once the category exists.
  { match: /SHOPIFY|PRINTFUL|GOOGLE ADS|SQUARESPACE|GODADDY|NAMECHEAP/, category: 'Business (Two Stroke Frenzy)' },
  { match: /COLUMBIA GAS|DOMINION|ENBRIDGE|NATURAL GAS/, category: 'Natural gas' },
  { match: /AEP|DUKE ENERGY|FIRSTENERGY|OHIO EDISON|ILLUMINATING|ELECTRIC/, category: 'Electric' },
  { match: /AKRON ?UTILITIES|WATER|SEWER|AQUA/, category: 'Water/sewer' },
  { match: /\bAT ?T\b|ATT\b/, category: 'AT&T phones' },
  { match: /KIDS COUNTRY|CHILD ?CARE|DAYCARE/, category: 'Child care (Kids Country)' },
  { match: /GEICO/, category: 'GEICO' },
  { match: /DISCOVER/, category: 'Discover' },
  { match: /APPLECARD|APPLE CARD|GS BANK/, category: 'Apple Card' },
  { match: /CREDIT ACCEPT/, category: 'Truck (Credit Acceptance)' },
  { match: /LENDMARK/, category: 'Dirt bike (Lendmark)' },
  // Living Water is the family's church as of Aug 2026; Rivertree is where
  // they gave before, kept so older statements still file correctly.
  { match: /CHURCH|TITHE|GIVING|LIVING WATER|RIVERTREE/, category: 'Church giving' },
  // Individual subscription line items (specific before the generic bucket).
  { match: /APPLE COM/, category: 'Apple services' },
  { match: /DISNEY ?PLUS|DISNEY\b/, category: 'Disney+' },
  { match: /PESTIE/, category: 'Pestie' },
  { match: /FABLETICS/, category: 'Fabletics' },
  { match: /KINDLE/, category: 'Kindle Unlimited' },
  { match: /BITWARDEN/, category: 'Bitwarden' },
  { match: /RING (SOLO|BASIC|PROTECT|MONTHLY)/, category: 'Ring' },
  { match: /NETFLIX|HULU|SPOTIFY|PARAMOUNT|PEACOCK|MAX\b|PRIME VIDEO|SUBSCRIPTION/, category: 'Subscriptions' },
];

function keywordGuess(description) {
  // Normalize the way banks mangle names: punctuation to spaces, collapsed.
  const norm = String(description || '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
  for (const rule of KEYWORD_GUESSES) {
    if (rule.match.test(norm)) return rule.category;
  }
  return null;
}

/** Stable identity for a statement line, for skip-on-reimport. */
function importHash(date, cents, description) {
  return crypto.createHash('sha1')
    .update(`${date}|${cents}|${merchantKey(description)}|${String(description).toUpperCase().replace(/\s+/g, ' ').trim()}`)
    .digest('hex');
}

module.exports = { parseStatement, parseCsv, parseDate, parseAmount, merchantKey, keywordGuess, importHash };
