'use strict';

// Seed data. Loaded ONE TIME ONLY, on a brand new database.
// A redeploy against an existing volume never re-runs this.

const INCOME = [
  { name: 'Miriam paycheck', person: 'Miriam', amount: 2369, per_month: 2 },
  { name: 'Chris paycheck', person: 'Chris', amount: 1450, per_month: 2 },
];

// Fixed bills -> tap-to-pay checklist on the dashboard.
// A third element can schedule a bill to begin in a future month; it stays off
// the dashboard until then.
const FIXED = [
  ['Mortgage (Rocket)', 1004],
  ['Natural gas', 150],
  ['Electric', 130],
  ['Water/sewer', 100],
  ['AT&T phones', 260],
  ['Child care (Kids Country)', 1355],
  ["Liza's cheerleading", 72],
  ['Church giving', 400],
  ["Miriam's lease", 899],
  ["Miriam's student loans", 411, { startsMonth: '2026-09' }],
  ['Truck (Credit Acceptance)', 351],
  ['Dirt bike (Lendmark)', 270],
  ['GEICO', 215],
  ['Discover', 262],
  ['Apple Card', 150],
  ['Settlement fund', 150],
  ['Subscriptions', 65],
];

// Variable categories -> amount entry through Quick Add
const VARIABLE = [
  ['Groceries', 700],
  ['Fuel', 350],
  ['Eating out & fun', 350],
  ['Personal - Chris', 75],
  ['Personal - Miriam', 75],
  ['Vehicle parts & maintenance', 75],
  ['Household & misc', 125],
];

const DEBTS = [
  { name: 'LVNV Funding #1', balance: 971, target: 500, label: 'ACTIVE LAWSUIT - settle first' },
  { name: 'WebBank/OneMain', balance: 829, target: 415, label: '' },
  { name: 'Emergency Medicine Physicians', balance: 1006, target: 500, label: '' },
  { name: 'Midland Credit', balance: 1684, target: 840, label: '' },
  { name: 'LVNV Funding #2', balance: 4410, target: 2205, label: '' },
];

// The settlement fund bill feeds the Debt Payoff tab's fund balance.
const SETTLEMENT_FUND_CATEGORY = 'Settlement fund';

/**
 * One-time data changes applied to a database that already exists, so a budget
 * that is already live picks them up too. Each runs at most once, tracked by key
 * in the meta table. Seeding is for new databases; this is for existing ones.
 */
const DATA_MIGRATIONS = [
  {
    // The family starts using the app in earnest on payday, Friday Aug 7 2026.
    // Anchor every income source without a payday to that date, biweekly.
    key: '2026-08-payday-anchors',
    paydays: { next_date: '2026-08-07', cadence: 'biweekly' },
  },
  {
    // Tithing comes out every payday Friday, not once a month: $200 per
    // check ($400 in a normal month, $600 when a third payday lands).
    key: '2026-08-tithe-per-payday',
    billCadence: { name: 'Church giving', cadence: 'payday', perPay: 200 },
  },
  {
    // They always tithe 10% of net income — the tithe follows the paychecks,
    // not a fixed number.
    key: '2026-08-tithe-ten-percent',
    percentBill: { name: 'Church giving', percent: 10 },
  },
  {
    // Their real subscriptions, split into individual tracked line items
    // (amounts mined from seven months of statements). The old lump
    // "Subscriptions" bill is archived; its history stays.
    key: '2026-08-split-subscriptions',
    split: {
      archive: 'Subscriptions',
      categories: [
        ['Apple services', 45],
        ['Disney+', 14],
        ['Pestie', 15],
        ['Fabletics', 12],
        ['Kindle Unlimited', 5],
        ['Bitwarden', 3],
        ['Ring', 3],
      ],
    },
  },
  {
    // Subscriptions are bills that charge themselves, not everyday spending —
    // they belong on the tap-to-pay checklist.
    key: '2026-08-subscriptions-are-bills',
    toFixed: ['Apple services', 'Disney+', 'Pestie', 'Fabletics', 'Kindle Unlimited', 'Bitwarden', 'Ring'],
  },
  {
    // Read out of seven months of real statements: the family pays bills the
    // moment a paycheck lands rather than waiting for the due date, so the
    // big ones run on a 28-day rhythm split across alternating paydays.
    // 0 = paid with the Aug 7 check (and every 4 weeks after);
    // 1 = paid with the Aug 21 check.
    key: '2026-08-payday-due-dates',
    paydayDueDates: {
      // Group paid Mondays after the Jul 10 / Aug 7 style checks
      'Discover': 0,
      'Apple Card': 0,
      "Miriam's lease": 0,
      'Water/sewer': 0,
      "Liza's cheerleading": 0,
      'Truck (Credit Acceptance)': 0,
      "Miriam's student loans": 0,
      // Group paid Mondays after the Jul 24 / Aug 21 style checks
      'Mortgage (Rocket)': 1,
      'Electric': 1,
      'Natural gas': 1,
      'AT&T phones': 1,
      'Dirt bike (Lendmark)': 1,
    },
    // Auto-drafts and card charges keep their own calendar day — nobody
    // pays these by hand, they just hit on the same date each month.
    dueDays: {
      'Child care (Kids Country)': 29,
      'GEICO': 19,
      'Disney+': 20,
      'Bitwarden': 14,
      'Ring': 27,
      'Pestie': 1,
      'Apple services': 12,
      'Fabletics': 9,
      'Kindle Unlimited': 18,
    },
  },
  {
    // Real amounts, averaged out of seven months of statements. Utilities use
    // the average across the year (gas swings $61 in July to $306 in April),
    // everything else uses what it currently bills.
    key: '2026-08-real-amounts',
    amounts: {
      'Natural gas': 169,
      'Electric': 144,
      'Water/sewer': 104,
      'AT&T phones': 248,
      'GEICO': 228,
      'Discover': 260,
      'Apple Card': 200,
      'Apple services': 45,
      'Ring': 5,
      'Pestie': 48,
      'Kindle Unlimited': 13,
      'Disney+': 14,
    },
  },
  {
    // Auto-drafts tick themselves off on the day they come out. Only the
    // reliably monthly ones — Pestie bills every other month, and Ring,
    // Kindle and Fabletics are irregular, so those stay hand-checked.
    key: '2026-08-auto-pay',
    autoPay: ['Child care (Kids Country)', 'GEICO', 'Disney+', 'Apple services'],
  },
  {
    // The truck and the dirt bike are new loans starting next month, and
    // both come out of the business account. Daycare is paid from Liza's.
    key: '2026-09-business-and-liza-accounts',
    // Checking is created first so it is the household default; the family
    // fills in the real balances (all three start at zero).
    accounts: ['Checking', 'Two Stroke Frenzy', 'Liza'],
    billAccounts: {
      'Truck (Credit Acceptance)': 'Two Stroke Frenzy',
      'Dirt bike (Lendmark)': 'Two Stroke Frenzy',
      'Child care (Kids Country)': 'Liza',
    },
    startsMonths: {
      'Truck (Credit Acceptance)': '2026-09',
      'Dirt bike (Lendmark)': '2026-09',
    },
  },
  {
    // Cancelled, so it stops counting against the budget. History stays.
    key: '2026-08-cancel-bitwarden',
    archiveCategories: ['Bitwarden'],
  },
  {
    // Both loans were actually paid in August out of the business account,
    // so they belong on August's checklist, not September's. The settlement
    // fund comes off the plan until the family knows what they will owe —
    // money already put in still counts on the Debt tab.
    key: '2026-08-loans-already-started',
    startsMonths: {
      'Truck (Credit Acceptance)': '2026-08',
      'Dirt bike (Lendmark)': '2026-08',
    },
    archiveCategories: ['Settlement fund'],
  },
  {
    // The agreed plan: the funeral-triage income the family is counting on,
    // trimmed everyday budgets that keep groceries and fuel whole, and the
    // vehicle-maintenance line folded into their two personal allowances.
    // Totals $1,470 of everyday spending against $8,138 coming in.
    key: '2026-09-agreed-budget',
    addIncome: {
      name: 'Funeral triage software',
      amount: 500,
      per_month: 1,
      person: 'Chris',
      cadence: 'monthly',
      onlyIfSourceCount: 2,
    },
    amounts: {
      'Eating out & fun': 210,
      'Personal - Chris': 67.5,
      'Personal - Miriam': 67.5,
      'Household & misc': 75,
    },
    archiveCategories: ['Vehicle parts & maintenance'],
  },
  {
    key: '2026-08-miriam-student-loans',
    category: {
      name: "Miriam's student loans",
      kind: 'fixed',
      budget: 411,
      startsMonth: '2026-09',
      after: "Miriam's lease",
    },
  },
];

module.exports = { INCOME, FIXED, VARIABLE, DEBTS, SETTLEMENT_FUND_CATEGORY, DATA_MIGRATIONS };
