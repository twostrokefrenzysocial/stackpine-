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
