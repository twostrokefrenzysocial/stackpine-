'use strict';

// End-to-end API tests. Runs the real Express app against a throwaway database.
//   node test/api.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.FAMILY_PIN = '2468';
process.env.TZ_NAME = 'America/New_York';

const { open } = require('../src/db');
const { createApp } = require('../server');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lfb-test-'));
const db = open(path.join(tmpDir, 'test.db'));
const server = createApp(db).listen(0);
const base = () => `http://127.0.0.1:${server.address().port}`;

let token = '';

function call(pathname, opts = {}) {
  const headers = { Accept: 'application/json' };
  if (opts.body) headers['Content-Type'] = 'application/json';
  if (opts.token !== null && token) headers.Authorization = `Bearer ${token}`;
  return fetch(base() + pathname, {
    method: opts.method || 'GET',
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  }).then(async (res) => ({ status: res.status, body: await res.json().catch(() => null) }));
}

const state = () => call('/api/state').then((r) => r.body);
const byName = (list, name) => list.find((c) => c.name === name);
const monthOf = (offset) => {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};

test.after(() => {
  server.close();
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------- auth

test('login rejects an unknown person', async () => {
  const res = await call('/api/login', { method: 'POST', body: { person: 'Dave', pin: '2468' }, token: null });
  assert.equal(res.status, 400);
});

test('login rejects a wrong PIN', async () => {
  const res = await call('/api/login', { method: 'POST', body: { person: 'Chris', pin: '1111' }, token: null });
  assert.equal(res.status, 401);
});

test('login succeeds with the family PIN', async () => {
  const res = await call('/api/login', { method: 'POST', body: { person: 'Chris', pin: '2468' }, token: null });
  assert.equal(res.status, 200);
  assert.equal(res.body.person, 'Chris');
  assert.ok(res.body.token);
  token = res.body.token;
});

test('state requires a token', async () => {
  const res = await fetch(base() + '/api/state');
  assert.equal(res.status, 401);
});

test('a tampered token is rejected', async () => {
  const res = await fetch(base() + '/api/state', { headers: { Authorization: 'Bearer Q2hyaXM.deadbeef' } });
  assert.equal(res.status, 401);
});

// ---------------------------------------------------------------- seed

test('seed data loads once with the expected shape', async () => {
  const s = await state();
  // Active fixed bills: the seed list plus the split-out subscriptions, less
  // Bitwarden (cancelled) and the truck + dirt bike (new loans, start Sept).
  assert.equal(s.categories.filter((c) => c.kind === 'fixed').length, 20);
  assert.equal(s.upcoming.filter((c) => c.kind === 'fixed').length, 1, "only Miriam's student loans wait for September");
  assert.equal(s.categories.filter((c) => c.kind === 'variable').length, 6, 'vehicle maintenance folded into personal money');
  assert.equal(s.income.total, 8138, 'two paychecks plus the funeral-triage contract');
  assert.equal(s.totals.income, 8138);
  assert.equal(byName(s.categories, 'Mortgage (Rocket)').budget, 1004);
  assert.equal(byName(s.categories, 'Groceries').budget, 700);
  assert.equal(s.debts.length, 5);
  assert.equal(s.debts[0].name, 'LVNV Funding #1');
  assert.equal(s.debts[0].target, 500);
  assert.equal(s.debts[0].label, 'ACTIVE LAWSUIT - settle first');
  assert.equal(s.person, 'Chris');
  assert.equal(s.readOnly, false);
});

test('re-opening the database does not re-seed', () => {
  const dbPath = path.join(tmpDir, 'test.db');
  const again = open(dbPath);
  const count = again.prepare('SELECT COUNT(*) AS n FROM categories').get().n;
  again.close();
  assert.equal(count, 31); // 16 fixed (incl archived Subscriptions) + loan + 7 variable + 7 subscription items
});

// ---------------------------------------------------------------- transactions

let groceriesId = 0;
let txId = 0;

test('adding a transaction moves the category and the totals', async () => {
  const before = await state();
  groceriesId = byName(before.categories, 'Groceries').id;

  const res = await call('/api/transactions', {
    method: 'POST',
    body: { category_id: groceriesId, amount: 82.47, note: 'Kroger' },
  });
  assert.equal(res.status, 201);
  txId = res.body.id;

  const groceries = byName(res.body.state.categories, 'Groceries');
  assert.equal(groceries.spent, 82.47);
  assert.equal(groceries.remaining, 617.53);
  assert.equal(groceries.status, 'ok');
  assert.equal(res.body.state.totals.spent, 82.47);
  assert.equal(res.body.state.totals.remaining, 8055.53);
  assert.equal(res.body.state.transactions[0].person, 'Chris');
  assert.equal(res.body.state.transactions[0].note, 'Kroger');
});

test('amount validation rejects zero, negatives and junk', async () => {
  for (const amount of [0, -5, 'abc', null]) {
    const res = await call('/api/transactions', { method: 'POST', body: { category_id: groceriesId, amount } });
    assert.equal(res.status, 400, `amount ${JSON.stringify(amount)} should be rejected`);
  }
});

test('an unknown category is rejected', async () => {
  const res = await call('/api/transactions', { method: 'POST', body: { category_id: 99999, amount: 10 } });
  assert.equal(res.status, 404);
});

test('a bad date is rejected', async () => {
  const res = await call('/api/transactions', {
    method: 'POST',
    body: { category_id: groceriesId, amount: 10, date: '2026-13-40' },
  });
  assert.equal(res.status, 400);
});

test('editing a transaction updates amount, note and person', async () => {
  const res = await call(`/api/transactions/${txId}`, {
    method: 'PUT',
    body: { amount: 100, note: 'Kroger + gas station', person: 'Miriam' },
  });
  assert.equal(res.status, 200);
  const tx = res.body.state.transactions.find((t) => t.id === txId);
  assert.equal(tx.amount, 100);
  assert.equal(tx.person, 'Miriam');
  assert.equal(byName(res.body.state.categories, 'Groceries').spent, 100);
});

test('status turns yellow at 80% and red past 100%', async () => {
  const res = await call('/api/transactions', {
    method: 'POST',
    body: { category_id: groceriesId, amount: 480, note: 'stock up' },
  });
  const warn = byName(res.body.state.categories, 'Groceries');
  assert.equal(warn.spent, 580);
  assert.equal(warn.status, 'warn');

  const over = await call('/api/transactions', {
    method: 'POST',
    body: { category_id: groceriesId, amount: 200, note: 'more' },
  });
  const red = byName(over.body.state.categories, 'Groceries');
  assert.equal(red.status, 'over');
  assert.equal(red.remaining, -80);

  // put Groceries back to a single transaction for later assertions
  for (const t of over.body.state.transactions.filter((t) => t.id !== txId)) {
    await call(`/api/transactions/${t.id}`, { method: 'DELETE' });
  }
  const s = await state();
  assert.equal(byName(s.categories, 'Groceries').spent, 100);
});

test('deleting a transaction removes it', async () => {
  const res = await call(`/api/transactions/${txId}`, { method: 'DELETE' });
  assert.equal(res.status, 200);
  assert.equal(byName(res.body.state.categories, 'Groceries').spent, 0);
  assert.equal(res.body.state.transactions.length, 0);

  const missing = await call(`/api/transactions/${txId}`, { method: 'DELETE' });
  assert.equal(missing.status, 404);
});

// ---------------------------------------------------------------- bills

test('tapping a bill pays it at the budgeted amount, tapping again clears it', async () => {
  const s = await state();
  const bill = byName(s.categories, 'Natural gas');
  assert.equal(bill.paid, false);

  const paid = await call(`/api/bills/${bill.id}/pay`, { method: 'POST', body: { paid: true } });
  assert.equal(paid.status, 200);
  const afterPay = byName(paid.body.state.categories, 'Natural gas');
  assert.equal(afterPay.paid, true);
  assert.equal(afterPay.spent, 169, 'the real amount off the statements');
  assert.equal(paid.body.state.transactions[0].source, 'billpay');

  // paying twice must not double-count
  await call(`/api/bills/${bill.id}/pay`, { method: 'POST', body: { paid: true } });
  const twice = await state();
  assert.equal(byName(twice.categories, 'Natural gas').spent, 169);

  const unpaid = await call(`/api/bills/${bill.id}/pay`, { method: 'POST', body: { paid: false } });
  const afterUnpay = byName(unpaid.body.state.categories, 'Natural gas');
  assert.equal(afterUnpay.paid, false);
  assert.equal(afterUnpay.spent, 0);
});

test('variable categories cannot be checked off as bills', async () => {
  const res = await call(`/api/bills/${groceriesId}/pay`, { method: 'POST', body: { paid: true } });
  assert.equal(res.status, 400);
});

// ---------------------------------------------------------------- months

test('past months are read-only once the grace window has closed', async (t) => {
  process.env.BACKDATE_GRACE_DAYS = '0';
  t.after(() => { delete process.env.BACKDATE_GRACE_DAYS; });

  const res = await call('/api/transactions', {
    method: 'POST',
    body: { category_id: groceriesId, amount: 25, date: `${monthOf(-1)}-15` },
  });
  assert.equal(res.status, 409);

  const view = await call(`/api/state?month=${monthOf(-1)}`);
  assert.equal(view.body.readOnly, true);
  assert.equal(view.body.grace.open, false);
});

test('a past month renders read-only with its own snapshot', async (t) => {
  process.env.BACKDATE_GRACE_DAYS = '0';
  t.after(() => { delete process.env.BACKDATE_GRACE_DAYS; });

  const res = await call(`/api/state?month=${monthOf(-1)}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.readOnly, true);
  assert.equal(res.body.month, monthOf(-1));
  assert.equal(res.body.transactions.length, 0);
  // Last month's snapshot: the categories that were active back then.
  assert.equal(res.body.categories.length, 24);
});

// ---------------------------------------------------------------- back-dating grace

// Grace is "day of month <= N", so deriving N from today keeps these tests
// honest on any calendar day and pins the boundary exactly.
const openGrace = async () => String(Number((await state()).today.slice(8, 10)));
const closedGrace = async () => String(Number((await state()).today.slice(8, 10)) - 1);

test('the grace window is inclusive of its final day', async (t) => {
  t.after(() => { delete process.env.BACKDATE_GRACE_DAYS; });
  process.env.BACKDATE_GRACE_DAYS = await openGrace();
  const res = await call(`/api/state?month=${monthOf(-1)}`);
  assert.equal(res.body.readOnly, false);
  assert.equal(res.body.grace.open, true);
});

test('the grace window shuts the day after it expires', async (t) => {
  t.after(() => { delete process.env.BACKDATE_GRACE_DAYS; });
  process.env.BACKDATE_GRACE_DAYS = await closedGrace();
  const res = await call(`/api/state?month=${monthOf(-1)}`);
  assert.equal(res.body.readOnly, true);
  assert.equal(res.body.grace.open, false);
});

test('last month accepts entries while the grace window is open', async (t) => {
  t.after(() => { delete process.env.BACKDATE_GRACE_DAYS; });
  process.env.BACKDATE_GRACE_DAYS = await openGrace();

  const last = monthOf(-1);
  const res = await call('/api/transactions', {
    method: 'POST',
    body: { category_id: groceriesId, amount: 25, date: `${last}-15`, note: 'forgot to log this' },
  });
  assert.equal(res.status, 201);
  assert.equal(res.body.state.month, last);
  assert.equal(res.body.state.readOnly, false);
  assert.equal(byName(res.body.state.categories, 'Groceries').spent, 25);

  // ...and it lands in last month, not this one
  const now = await state();
  assert.equal(byName(now.categories, 'Groceries').spent, 0);
  assert.equal(now.grace.open, true);
  assert.equal(now.grace.earliestDate, `${last}-01`);

  // it can be edited and deleted while the window is open
  const edited = await call(`/api/transactions/${res.body.id}`, { method: 'PUT', body: { amount: 30 } });
  assert.equal(edited.status, 200);
  assert.equal(byName(edited.body.state.categories, 'Groceries').spent, 30);

  const gone = await call(`/api/transactions/${res.body.id}`, { method: 'DELETE' });
  assert.equal(gone.status, 200);
  assert.equal(byName(gone.body.state.categories, 'Groceries').spent, 0);
});

test('the grace window never reaches back two months', async (t) => {
  t.after(() => { delete process.env.BACKDATE_GRACE_DAYS; });
  process.env.BACKDATE_GRACE_DAYS = '31';

  const res = await call('/api/transactions', {
    method: 'POST',
    body: { category_id: groceriesId, amount: 25, date: `${monthOf(-2)}-15` },
  });
  assert.equal(res.status, 409);
});

test('future months are refused', async () => {
  const res = await call('/api/transactions', {
    method: 'POST',
    body: { category_id: groceriesId, amount: 25, date: `${monthOf(1)}-02` },
  });
  assert.equal(res.status, 409);
});

test("last month's bill checklist works during grace and dates into that month", async (t) => {
  t.after(() => { delete process.env.BACKDATE_GRACE_DAYS; });
  process.env.BACKDATE_GRACE_DAYS = await openGrace();

  const last = monthOf(-1);
  const s = await state();
  const bill = byName(s.categories, 'Electric');

  const paid = await call(`/api/bills/${bill.id}/pay`, { method: 'POST', body: { paid: true, month: last } });
  assert.equal(paid.status, 200);
  assert.equal(paid.body.state.month, last);
  assert.equal(byName(paid.body.state.categories, 'Electric').paid, true);
  const tx = paid.body.state.transactions.find((x) => x.category === 'Electric');
  assert.equal(tx.date.slice(0, 7), last);

  // this month's Electric is untouched
  const thisMonth = await state();
  assert.equal(byName(thisMonth.categories, 'Electric').paid, false);

  const cleared = await call(`/api/bills/${bill.id}/pay`, { method: 'POST', body: { paid: false, month: last } });
  assert.equal(byName(cleared.body.state.categories, 'Electric').paid, false);
});

test('a bill cannot be dated outside the month it is paid for', async (t) => {
  t.after(() => { delete process.env.BACKDATE_GRACE_DAYS; });
  process.env.BACKDATE_GRACE_DAYS = await openGrace();

  const s = await state();
  const bill = byName(s.categories, 'Electric');
  const res = await call(`/api/bills/${bill.id}/pay`, {
    method: 'POST',
    body: { paid: true, month: monthOf(-1), date: `${monthOf(0)}-03` },
  });
  assert.equal(res.status, 400);
});

test('a closed month rejects bill payment too', async (t) => {
  process.env.BACKDATE_GRACE_DAYS = '0';
  t.after(() => { delete process.env.BACKDATE_GRACE_DAYS; });

  const s = await state();
  const bill = byName(s.categories, 'Electric');
  const res = await call(`/api/bills/${bill.id}/pay`, {
    method: 'POST',
    body: { paid: true, month: monthOf(-1) },
  });
  assert.equal(res.status, 409);
});

test('a malformed month is rejected', async () => {
  const res = await call('/api/state?month=not-a-month');
  assert.equal(res.status, 400);
});

// ---------------------------------------------------------------- scheduled bills

test("Miriam's student loans are seeded but held back until they start", async () => {
  const s = await state();
  // Not on this month's dashboard, and not in this month's budget total.
  assert.equal(byName(s.categories, "Miriam's student loans"), undefined);

  const pending = byName(s.upcoming, "Miriam's student loans");
  assert.ok(pending, 'the loan should be listed as upcoming');
  assert.equal(pending.budget, 411);
  assert.equal(pending.kind, 'fixed');
  assert.equal(pending.startsMonth, '2026-09');
});

test('a not-yet-started bill takes no money', async () => {
  const s = await state();
  const loanId = byName(s.upcoming, "Miriam's student loans").id;

  const spend = await call('/api/transactions', { method: 'POST', body: { category_id: loanId, amount: 411 } });
  assert.equal(spend.status, 400);
  assert.match(spend.body.error, /does not start until 2026-09/);

  const tick = await call(`/api/bills/${loanId}/pay`, { method: 'POST', body: { paid: true } });
  assert.equal(tick.status, 400);
});

test('a scheduled bill joins the budget in its start month', async () => {
  const s = await state();
  const loanId = byName(s.upcoming, "Miriam's student loans").id;

  // Pull the start date back to this month, the way Settings would.
  const moved = await call(`/api/categories/${loanId}`, {
    method: 'PUT',
    body: { starts_month: monthOf(0) },
  });
  assert.equal(moved.status, 200);
  const live = byName(moved.body.state.categories, "Miriam's student loans");
  assert.ok(live, 'the loan should now be on the dashboard');
  assert.equal(live.budget, 411);
  assert.equal(live.paid, false);
  assert.equal(byName(moved.body.state.upcoming, "Miriam's student loans"), undefined);

  // ...and it can be ticked off like any other bill
  const paid = await call(`/api/bills/${loanId}/pay`, { method: 'POST', body: { paid: true } });
  assert.equal(byName(paid.body.state.categories, "Miriam's student loans").spent, 411);
  await call(`/api/bills/${loanId}/pay`, { method: 'POST', body: { paid: false } });

  // put it back where it belongs
  await call(`/api/categories/${loanId}`, { method: 'PUT', body: { starts_month: '2026-09' } });
  const restored = await state();
  assert.equal(byName(restored.categories, "Miriam's student loans"), undefined);
  assert.equal(byName(restored.upcoming, "Miriam's student loans").startsMonth, '2026-09');
});

test('a start month in the past just means "active now"', async () => {
  const added = await call('/api/categories', {
    method: 'POST',
    body: { name: 'Backdated bill', kind: 'fixed', budget: 10, starts_month: '2020-01' },
  });
  assert.equal(added.status, 201);
  assert.ok(byName(added.body.state.categories, 'Backdated bill'));
  await call(`/api/categories/${added.body.id}`, { method: 'DELETE' });
});

test('a malformed start month is rejected', async () => {
  const res = await call('/api/categories', {
    method: 'POST',
    body: { name: 'Bad start', kind: 'fixed', budget: 10, starts_month: 'soon' },
  });
  assert.equal(res.status, 400);
});

test('the student-loan migration also lands on a database that already exists', () => {
  const legacyPath = path.join(tmpDir, 'legacy.db');
  const Database = require('better-sqlite3');

  // A database seeded before the loan existed, with the migration not yet run.
  const first = open(legacyPath);
  first.prepare(`DELETE FROM categories WHERE name = ?`).run("Miriam's student loans");
  first.prepare(`DELETE FROM meta WHERE key = ?`).run('2026-08-miriam-student-loans');
  first.close();

  const reopened = open(legacyPath);
  const row = reopened
    .prepare(`SELECT budget_cents, starts_month, sort_order FROM categories WHERE name = ?`)
    .get("Miriam's student loans");
  const lease = reopened
    .prepare(`SELECT sort_order FROM categories WHERE name = ?`)
    .get("Miriam's lease");
  assert.ok(row, 'the migration should add the loan to an existing budget');
  assert.equal(row.budget_cents, 41100);
  assert.equal(row.starts_month, '2026-09');
  assert.equal(row.sort_order, lease.sort_order + 1, 'it should sit right after her lease');

  // Running again must not duplicate it.
  reopened.close();
  const third = open(legacyPath);
  const count = third.prepare(`SELECT COUNT(*) AS n FROM categories WHERE name = ?`).get("Miriam's student loans").n;
  third.close();
  assert.equal(count, 1);
  assert.ok(Database);
});

// ---------------------------------------------------------------- due dates

test('a due day that overflows a short month lands on its last day', () => {
  const { dueDateIn } = require('../src/util');
  assert.equal(dueDateIn('2026-09', 31), '2026-09-30'); // September has 30
  assert.equal(dueDateIn('2027-02', 31), '2027-02-28');
  assert.equal(dueDateIn('2028-02', 30), '2028-02-29'); // leap year
  assert.equal(dueDateIn('2026-08', 15), '2026-08-15');
  assert.equal(dueDateIn('2026-08', 0), '2026-08-01');  // clamped up
});

let scratchBillId = 0;

test('setting a due day shows up on the bill', async () => {
  const s = await state();
  // A fresh bill starts on no schedule at all.
  const made = await call('/api/categories', {
    method: 'POST', body: { name: 'Scratch bill', kind: 'fixed', budget: 60 },
  });
  assert.equal(made.status, 201);
  scratchBillId = made.body.id;
  const bill = byName(made.body.state.categories, 'Scratch bill');
  assert.equal(bill.dueDay, null);
  assert.equal(bill.duePayday, null);
  assert.equal(bill.dueStatus, null);

  const dayToday = Number(s.today.slice(8, 10));
  const res = await call(`/api/categories/${scratchBillId}`, { method: 'PUT', body: { due_day: dayToday } });
  assert.equal(res.status, 200);

  const due = byName(res.body.state.categories, 'Scratch bill');
  assert.equal(due.dueDay, dayToday);
  assert.equal(due.dueDate, s.today);
  assert.equal(due.dueIn, 0);
  assert.equal(due.dueStatus, 'today');
});

test('paying a bill clears its due warning', async () => {
  const s = await state();
  const bill = byName(s.categories, 'Scratch bill');
  assert.equal(bill.dueStatus, 'today');

  const paid = await call(`/api/bills/${bill.id}/pay`, { method: 'POST', body: { paid: true } });
  const after = byName(paid.body.state.categories, 'Scratch bill');
  assert.equal(after.paid, true);
  assert.equal(after.dueStatus, null, 'a paid bill is not still nagging');

  await call(`/api/bills/${bill.id}/pay`, { method: 'POST', body: { paid: false } });
  await call(`/api/categories/${bill.id}`, { method: 'DELETE' });
});

test('bills are ordered by whatever gets paid next', async () => {
  const s = await state();
  const fixed = s.categories.filter((c) => c.kind === 'fixed');
  const dated = fixed.filter((c) => c.dueDate);
  const undated = fixed.filter((c) => !c.dueDate);

  // every dated bill precedes every undated one
  const lastDated = fixed.findIndex((c) => c === dated[dated.length - 1]);
  const firstUndated = undated.length ? fixed.indexOf(undated[0]) : Infinity;
  assert.ok(lastDated < firstUndated, 'undated bills follow the dated ones');

  // and the dated ones run earliest-first
  const dates = dated.map((c) => c.dueDate);
  assert.deepEqual(dates, dates.slice().sort(), 'due dates ascend');
});

test('bills the family pays by hand ride their paycheck, not a calendar day', async () => {
  const s = await state();
  assert.ok(s.paydays.length, 'the month knows its paydays');
  // The seeded schedule, read out of real statements: two alternating groups.
  const water = byName(s.categories, 'Water/sewer');
  const electric = byName(s.categories, 'Electric');
  assert.equal(water.duePayday, 0);
  assert.equal(water.dueDay, null, 'a payday bill has no calendar day');
  assert.equal(electric.duePayday, 1);

  const parityOf = (iso) => (s.paydays.find((p) => p.date === iso) || {}).parity;
  assert.equal(parityOf(water.dueDate), 0, 'due on one of its own paydays');
  assert.equal(parityOf(electric.dueDate), 1);
  assert.notEqual(water.dueDate, electric.dueDate, 'the two groups pay on different checks');

  // switching a bill to a calendar day drops its paycheck slot, and back again
  const back = await call(`/api/categories/${water.id}`, { method: 'PUT', body: { due_day: 15 } });
  const cal = byName(back.body.state.categories, 'Water/sewer');
  assert.equal(cal.duePayday, null);
  assert.equal(cal.dueDay, 15);

  const restored = await call(`/api/categories/${water.id}`, { method: 'PUT', body: { due_payday: 0 } });
  const again = byName(restored.body.state.categories, 'Water/sewer');
  assert.equal(again.duePayday, 0);
  assert.equal(again.dueDay, null);

  const nope = await call(`/api/categories/${water.id}`, { method: 'PUT', body: { due_payday: 7 } });
  assert.equal(nope.status, 400);
});

test('a nonsense due day is rejected', async () => {
  const s = await state();
  const bill = byName(s.categories, 'Electric');
  for (const day of [0, 32, -3, 'friday']) {
    const res = await call(`/api/categories/${bill.id}`, { method: 'PUT', body: { due_day: day } });
    assert.equal(res.status, 400, `due_day ${JSON.stringify(day)} should be rejected`);
  }
});

test('past months do not raise due warnings', async () => {
  const s = await state();
  const bill = byName(s.categories, 'Electric');
  await call(`/api/categories/${bill.id}`, { method: 'PUT', body: { due_day: 1 } });

  const past = await call(`/api/state?month=${monthOf(-1)}`);
  const old = byName(past.body.categories, 'Electric');
  assert.equal(old.dueDay, 1);
  assert.equal(old.dueStatus, null, 'a closed month should not nag about due dates');

  await call(`/api/categories/${bill.id}`, { method: 'PUT', body: { due_day: null } });
});

// ---------------------------------------------------------------- settings

test('editing a budget changes the current month only', async () => {
  const s = await state();
  const fuel = byName(s.categories, 'Fuel');
  const res = await call(`/api/categories/${fuel.id}`, { method: 'PUT', body: { budget: 400 } });
  assert.equal(res.status, 200);
  assert.equal(byName(res.body.state.categories, 'Fuel').budget, 400);

  const past = await call(`/api/state?month=${monthOf(-1)}`);
  assert.equal(byName(past.body.categories, 'Fuel').budget, 350);
});

test('editing income updates the monthly total', async () => {
  const s = await state();
  const chris = s.income.sources.find((x) => x.person === 'Chris');
  const res = await call(`/api/income/${chris.id}`, { method: 'PUT', body: { amount: 1500 } });
  assert.equal(res.body.state.income.total, 8238);
  assert.equal(res.body.state.totals.income, 8238);
  await call(`/api/income/${chris.id}`, { method: 'PUT', body: { amount: 1450 } });
});

test('categories can be added and archived without losing history', async () => {
  const added = await call('/api/categories', {
    method: 'POST',
    body: { name: 'Kids activities', kind: 'variable', budget: 60 },
  });
  assert.equal(added.status, 201);
  const id = added.body.id;

  const dupe = await call('/api/categories', { method: 'POST', body: { name: 'Kids activities', kind: 'variable' } });
  assert.equal(dupe.status, 400);

  await call('/api/transactions', { method: 'POST', body: { category_id: id, amount: 12 } });
  const removed = await call(`/api/categories/${id}`, { method: 'DELETE' });
  assert.equal(removed.status, 200);
  // It still holds $12 this month, so it stays visible but flagged as closed.
  assert.equal(byName(removed.body.state.categories, 'Kids activities').archived, true);
  assert.ok(removed.body.state.transactions.some((t) => t.category === 'Kids activities'));

  // Once its spending is gone it drops off the current month entirely.
  const tx = removed.body.state.transactions.find((t) => t.category === 'Kids activities');
  const after = await call(`/api/transactions/${tx.id}`, { method: 'DELETE' });
  assert.equal(byName(after.body.state.categories, 'Kids activities'), undefined);
});

test('an archived category cannot take new transactions', async () => {
  const added = await call('/api/categories', { method: 'POST', body: { name: 'Temp', kind: 'variable', budget: 10 } });
  await call(`/api/categories/${added.body.id}`, { method: 'DELETE' });
  const res = await call('/api/transactions', { method: 'POST', body: { category_id: added.body.id, amount: 5 } });
  assert.equal(res.status, 404);
});

// ---------------------------------------------------------------- weekly breakdown

test('weeks tile the whole month with no gaps', async () => {
  const s = await state();
  assert.ok(s.weeks.length >= 4 && s.weeks.length <= 6, `got ${s.weeks.length} weeks`);
  assert.equal(s.weeks[0].from, `${s.month}-01`, 'first week starts on the 1st');
  const last = s.weeks[s.weeks.length - 1];
  assert.ok(/-(28|29|30|31)$/.test(last.to), 'last week ends on the month end');
  for (let i = 1; i < s.weeks.length; i++) {
    const prevEnd = new Date(s.weeks[i - 1].to + 'T00:00:00Z');
    const nextStart = new Date(s.weeks[i].from + 'T00:00:00Z');
    assert.equal(nextStart - prevEnd, 86400000, 'weeks are contiguous');
  }
  assert.equal(s.weeks.filter((w) => w.isCurrent).length, 1, 'exactly one current week');
});

test('spending and income land in the right week', async () => {
  const before = await state();
  const wk = before.weeks.find((w) => w.isCurrent);

  const spend = await call('/api/transactions', {
    method: 'POST',
    body: { category_id: groceriesId, amount: 55.25, note: 'weekly test' },
  });
  const incomeRes = await call('/api/income/entries', { method: 'POST', body: { amount: 200, label: 'weekly income' } });

  const s = incomeRes.body.state;
  const now = s.weeks.find((w) => w.isCurrent);
  assert.equal(now.everyday, wk.everyday + 55.25, 'groceries count as everyday spending');
  assert.equal(now.spent, wk.spent + 55.25);
  assert.equal(now.income, wk.income + 200);

  // a bill payment counts as spent but NOT as everyday pace
  const gas = byName(s.categories, 'Natural gas');
  const paid = await call(`/api/bills/${gas.id}/pay`, { method: 'POST', body: { paid: true } });
  const after = paid.body.state.weeks.find((w) => w.isCurrent);
  assert.equal(after.everyday, now.everyday, 'bills stay out of the everyday number');
  assert.equal(after.spent, now.spent + 169);

  // current-week summary matches
  assert.equal(paid.body.state.week.everyday, after.everyday);
  assert.ok(paid.body.state.week.allowance > 0);

  // cleanup
  await call(`/api/bills/${gas.id}/pay`, { method: 'POST', body: { paid: false } });
  await call(`/api/transactions/${spend.body.id}`, { method: 'DELETE' });
  await call(`/api/income/entries/${incomeRes.body.id}`, { method: 'DELETE' });
});

test('the weekly allowance is the variable budget at an even daily pace', async () => {
  const s = await state();
  const varBudget = s.categories.filter((c) => c.kind === 'variable')
    .reduce((sum, c) => sum + Math.round(c.budget * 100), 0);
  const daysInMonth = Number(s.months && new Date(
    Number(s.month.slice(0, 4)), Number(s.month.slice(5, 7)), 0
  ).getDate());
  assert.equal(Math.round(s.week.allowance * 100), Math.round((varBudget * 7) / daysInMonth));
});

test('a past month has weeks but no current-week pace', async (t) => {
  process.env.BACKDATE_GRACE_DAYS = '0';
  t.after(() => { delete process.env.BACKDATE_GRACE_DAYS; });
  const res = await call(`/api/state?month=${monthOf(-1)}`);
  assert.ok(res.body.weeks.length >= 4);
  assert.equal(res.body.week, null);
  assert.equal(res.body.weeks.filter((w) => w.isCurrent).length, 0);
});

// ---------------------------------------------------------------- paydays

test('payday anchors: seeded to Friday Aug 7 2026 biweekly, rolling forward', async () => {
  const { nextOccurrence } = require('../src/util');
  assert.equal(nextOccurrence('2026-08-07', 'biweekly', '2026-08-02'), '2026-08-07');
  assert.equal(nextOccurrence('2026-08-07', 'biweekly', '2026-08-07'), '2026-08-07', 'payday itself counts');
  assert.equal(nextOccurrence('2026-08-07', 'biweekly', '2026-08-08'), '2026-08-21');
  assert.equal(nextOccurrence('2026-08-07', 'biweekly', '2026-12-25'), '2026-12-25', 'biweekly from Aug 7 lands on Dec 25');
  assert.equal(nextOccurrence('2026-01-31', 'monthly', '2026-02-01'), '2026-02-28', 'monthly clamps short months');

  const s = await state();
  // The two paychecks are biweekly; the monthly contract keeps its own rhythm.
  for (const src of s.income.sources.filter((x) => x.cadence === 'biweekly')) {
    assert.ok(src.nextPayday >= s.today, src.name + ' payday is never in the past');
    assert.equal(typeof src.payInDays, 'number');
  }
  assert.equal(s.income.sources.filter((x) => x.cadence === 'biweekly').length, 2);
});

test('paydays are editable per source', async () => {
  const s = await state();
  const chris = s.income.sources.find((x) => x.person === 'Chris');
  const res = await call(`/api/income/${chris.id}`, { method: 'PUT', body: { next_date: s.today, cadence: 'weekly' } });
  assert.equal(res.status, 200);
  const after = res.body.state.income.sources.find((x) => x.id === chris.id);
  assert.equal(after.nextPayday, s.today);
  assert.equal(after.payInDays, 0);
  assert.equal(after.cadence, 'weekly');

  const bad1 = await call(`/api/income/${chris.id}`, { method: 'PUT', body: { cadence: 'fortnightly' } });
  assert.equal(bad1.status, 400);
  const bad2 = await call(`/api/income/${chris.id}`, { method: 'PUT', body: { next_date: 'friday' } });
  assert.equal(bad2.status, 400);

  // put it back
  await call(`/api/income/${chris.id}`, { method: 'PUT', body: { next_date: '2026-08-07', cadence: 'biweekly' } });
});

test('the payday nudge fires on the day and only on the day', async () => {
  const { computePaydayNudge } = require('../src/push');
  const s = await state();
  const chris = s.income.sources.find((x) => x.person === 'Chris');

  await call(`/api/income/${chris.id}`, { method: 'PUT', body: { next_date: s.today, cadence: 'biweekly' } });
  const nudge = computePaydayNudge(db);
  assert.ok(nudge, 'payday today → nudge');
  assert.match(nudge.body, /Chris paycheck/);

  await call(`/api/income/${chris.id}`, { method: 'PUT', body: { next_date: '2026-08-07', cadence: 'biweekly' } });
  const miriam = s.income.sources.find((x) => x.person === 'Miriam');
  // move both paydays off today unless today IS an occurrence
  const off = computePaydayNudge(db);
  const chrisNext = (await state()).income.sources.find((x) => x.id === chris.id).nextPayday;
  const miriamNext = (await state()).income.sources.find((x) => x.id === miriam.id).nextPayday;
  if (chrisNext !== (await state()).today && miriamNext !== (await state()).today) {
    assert.equal(off, null, 'no payday, no nudge');
  }
});

// ---------------------------------------------------------------- per-payday bills & split subscriptions

test('the tithe is 10% of net income, owed as paychecks actually land', async () => {
  const s = await state();
  const tithe = byName(s.categories, 'Church giving');
  assert.equal(tithe.cadence, 'payday');
  assert.equal(tithe.percent, 10);
  assert.ok(tithe.expected >= 2, 'biweekly from Aug 7 means at least 2 paydays a month');
  assert.equal(tithe.budget, Math.round(s.totals.income * 10) / 100, 'monthly tithe budget = 10% of expected income');
  assert.equal(tithe.dueNow, 0, 'nothing owed before money comes in');

  // paying before any income is logged is refused with guidance
  const early = await call(`/api/bills/${tithe.id}/pay`, { method: 'POST', body: { paid: true } });
  assert.equal(early.status, 400);
  assert.match(early.body.error, /Log the paychecks first/);

  // a payday lands: both checks logged
  const check = await call('/api/income/entries', { method: 'POST', body: { amount: 3819, label: 'payday 1' } });
  let now = byName(check.body.state.categories, 'Church giving');
  assert.equal(now.dueNow, 381.9, '10% of what came in');

  const one = await call(`/api/bills/${tithe.id}/pay`, { method: 'POST', body: { paid: true } });
  now = byName(one.body.state.categories, 'Church giving');
  assert.equal(now.spent, 381.9);
  assert.equal(now.paidCount, 1);
  assert.equal(now.paid, false);
  assert.equal(now.dueNow, 0, 'square with the church again');

  // tithing twice on the same money is refused
  const again = await call(`/api/bills/${tithe.id}/pay`, { method: 'POST', body: { paid: true } });
  assert.equal(again.status, 400);
  assert.match(again.body.error, /fully paid/);

  // second payday: more income, more tithe
  const check2 = await call('/api/income/entries', { method: 'POST', body: { amount: 3819, label: 'payday 2' } });
  assert.equal(byName(check2.body.state.categories, 'Church giving').dueNow, 381.9);
  const two = await call(`/api/bills/${tithe.id}/pay`, { method: 'POST', body: { paid: true } });
  now = byName(two.body.state.categories, 'Church giving');
  assert.equal(now.spent, 763.8);
  if (now.expected === 2) assert.equal(now.paid, true);

  // cleanup: untithe and unlog
  await call(`/api/bills/${tithe.id}/pay`, { method: 'POST', body: { paid: false } });
  await call(`/api/bills/${tithe.id}/pay`, { method: 'POST', body: { paid: false } });
  await call(`/api/income/entries/${check.body.id}`, { method: 'DELETE' });
  await call(`/api/income/entries/${check2.body.id}`, { method: 'DELETE' });
  assert.equal(byName((await state()).categories, 'Church giving').spent, 0);
});

test('a bill can be switched between monthly and payday cadence', async () => {
  const s = await state();
  const gas = byName(s.categories, 'Natural gas');
  const flip = await call(`/api/categories/${gas.id}`, { method: 'PUT', body: { cadence: 'payday' } });
  assert.equal(byName(flip.body.state.categories, 'Natural gas').cadence, 'payday');
  const back = await call(`/api/categories/${gas.id}`, { method: 'PUT', body: { cadence: 'monthly' } });
  assert.equal(byName(back.body.state.categories, 'Natural gas').cadence, null);
  const junk = await call(`/api/categories/${gas.id}`, { method: 'PUT', body: { cadence: 'fortnightly' } });
  assert.equal(junk.status, 400);
});

test('subscriptions are split into individual line items', async () => {
  const s = await state();
  assert.equal(byName(s.categories, 'Subscriptions'), undefined, 'the lump category is archived');
  // Amounts are the real ones off the statements; Bitwarden was cancelled.
  for (const [name, budget] of [['Apple services', 45], ['Disney+', 14], ['Pestie', 48], ['Kindle Unlimited', 13], ['Ring', 5]]) {
    const c = byName(s.categories, name);
    assert.ok(c, name + ' exists');
    assert.equal(c.kind, 'fixed', name + ' sits on the bill checklist');
    assert.equal(c.budget, budget);
  }
  assert.equal(byName(s.categories, 'Bitwarden'), undefined, 'cancelled subscriptions drop off');

  // the matcher files each service into its own line
  const { keywordGuess } = require('../src/import');
  assert.equal(keywordGuess('APPLE.COM/BILL 866-712-7753'), 'Apple services');
  assert.equal(keywordGuess('DISNEY PLUS 888-905-7888'), 'Disney+');
  assert.equal(keywordGuess('SP PESTIE INC'), 'Pestie');
  assert.equal(keywordGuess('KINDLE UNLTD*2K4EA35'), 'Kindle Unlimited');
  assert.equal(keywordGuess('NETFLIX.COM'), 'Subscriptions', 'unsplit services still hit the bucket');
});

// ---------------------------------------------------------------- income received

test('logging a paycheck records the actual amount against its source', async () => {
  const s = await state();
  assert.equal(s.totals.received, 0);
  const chris = s.income.sources.find((x) => x.person === 'Chris');

  // his paycheck came in different from the plan
  const res = await call('/api/income/entries', {
    method: 'POST',
    body: { source_id: chris.id, amount: 1502.75 },
  });
  assert.equal(res.status, 201);

  const st = res.body.state;
  assert.equal(st.totals.received, 1502.75);
  assert.equal(st.totals.income, 8138, 'the plan number does not move');
  const src = st.income.sources.find((x) => x.id === chris.id);
  assert.equal(src.received, 1502.75);
  assert.equal(src.checks, 1);
  const entry = st.income.entries[0];
  assert.equal(entry.label, 'Chris paycheck', 'label defaults to the source name');
  assert.equal(entry.person, 'Chris');
});

test('one-off income needs no source', async () => {
  const res = await call('/api/income/entries', {
    method: 'POST',
    body: { amount: 500, label: 'Software payment', note: 'first month' },
  });
  assert.equal(res.status, 201);
  const entry = res.body.state.income.entries.find((e) => e.label === 'Software payment');
  assert.ok(entry);
  assert.equal(entry.source_id, null);
  assert.equal(res.body.state.totals.received, 2002.75);
});

test('income entries can be edited and deleted', async () => {
  const s = await state();
  const entry = s.income.entries.find((e) => e.label === 'Software payment');

  const edited = await call(`/api/income/entries/${entry.id}`, {
    method: 'PUT',
    body: { amount: 525, person: 'Miriam' },
  });
  assert.equal(edited.status, 200);
  const after = edited.body.state.income.entries.find((e) => e.id === entry.id);
  assert.equal(after.amount, 525);
  assert.equal(after.person, 'Miriam');
  assert.equal(edited.body.state.totals.received, 2027.75);

  const gone = await call(`/api/income/entries/${entry.id}`, { method: 'DELETE' });
  assert.equal(gone.status, 200);
  assert.equal(gone.body.state.totals.received, 1502.75);
});

test('income entry validation mirrors spending', async () => {
  for (const body of [
    { amount: 0 },
    { amount: -20 },
    { amount: 'abc' },
    { amount: 100, date: '2026-99-01' },
    { amount: 100, source_id: 424242 },
  ]) {
    const res = await call('/api/income/entries', { method: 'POST', body });
    assert.ok([400, 404].includes(res.status), `${JSON.stringify(body)} should be rejected, got ${res.status}`);
  }
});

test('income in a closed month is refused, grace month accepted', async (t) => {
  t.after(() => { delete process.env.BACKDATE_GRACE_DAYS; });

  process.env.BACKDATE_GRACE_DAYS = '0';
  const closed = await call('/api/income/entries', {
    method: 'POST',
    body: { amount: 100, date: `${monthOf(-1)}-10` },
  });
  assert.equal(closed.status, 409);

  process.env.BACKDATE_GRACE_DAYS = await openGrace();
  const ok = await call('/api/income/entries', {
    method: 'POST',
    body: { amount: 100, label: 'late check', date: `${monthOf(-1)}-10` },
  });
  assert.equal(ok.status, 201);
  assert.equal(ok.body.state.month, monthOf(-1));

  // last month's entry does not bleed into this month
  const now = await state();
  assert.equal(now.totals.received, 1502.75);
  await call(`/api/income/entries/${ok.body.id}`, { method: 'DELETE' });
});

test('cleanup: remove the logged paycheck', async () => {
  const s = await state();
  for (const e of s.income.entries) {
    await call(`/api/income/entries/${e.id}`, { method: 'DELETE' });
  }
  assert.equal((await state()).totals.received, 0);
});

// ---------------------------------------------------------------- debt + fund

test('the settlement fund tracks bills, deposits and settlements', async () => {
  const s = await state();
  // The settlement-fund bill was retired until the family knows what they
  // owe, so the fund now grows by deposit; past contributions still count.
  assert.equal(byName(s.categories, 'Settlement fund'), undefined);
  const contributed = s.fund.contributed;

  const deposit = await call('/api/fund/deposits', {
    method: 'POST',
    body: { amount: 650 - contributed, note: 'Third paycheck' },
  });
  assert.equal(deposit.status, 201);
  assert.equal(deposit.body.state.fund.contributed, contributed);
  assert.equal(deposit.body.state.fund.balance, 650);
  assert.equal(deposit.body.state.fund.deposited, 650 - contributed);

  const lvnv = deposit.body.state.debts[0];
  assert.equal(lvnv.coverage, 100); // 650 covers the 500 target

  const settled = await call(`/api/debts/${lvnv.id}/settle`, { method: 'POST', body: { amount: 500 } });
  assert.equal(settled.status, 200);
  const done = settled.body.state.debts.find((d) => d.id === lvnv.id);
  assert.equal(done.settled, true);
  assert.equal(done.settledAmount, 500);
  assert.equal(done.settledBy, 'Chris');
  assert.ok(done.settledDate);
  assert.equal(settled.body.state.fund.balance, 150);
  assert.equal(settled.body.state.fund.spent, 500);

  const reopened = await call(`/api/debts/${lvnv.id}/unsettle`, { method: 'POST' });
  assert.equal(reopened.body.state.fund.balance, 650);
  assert.equal(reopened.body.state.debts.find((d) => d.id === lvnv.id).settled, false);

  const removedDeposit = await call(`/api/fund/deposits/${deposit.body.id}`, { method: 'DELETE' });
  assert.equal(removedDeposit.body.state.fund.balance, contributed, 'removing the deposit leaves past contributions');
});

test('debt details can be edited', async () => {
  const s = await state();
  const debt = s.debts.find((d) => d.name === 'Midland Credit');
  const res = await call(`/api/debts/${debt.id}`, {
    method: 'PUT',
    body: { balance: 1700, target: 800, label: 'Called 7/12' },
  });
  const updated = res.body.state.debts.find((d) => d.id === debt.id);
  assert.equal(updated.balance, 1700);
  assert.equal(updated.target, 800);
  assert.equal(updated.label, 'Called 7/12');
});

// ---------------------------------------------------------------- statement import

const STATEMENT = () => {
  const m = monthOf(0);
  const d = (day) => `${m.slice(5, 7)}/${String(day).padStart(2, '0')}/${m.slice(0, 4)}`;
  return [
    'Date,Description,Withdrawals,Deposits,Balance',
    `${d(1)},KROGER #945 CINCINNATI OH,82.13,,`,
    `${d(1)},SPEEDWAY 08123 HILLSBORO,45.00,,`,
    `${d(2)},MCDONALD'S F32191,12.87,,`,
    `${d(2)},DIRECT DEP PAYROLL COMPANY,,1502.75,`,
    `${d(2)},TOTALLY UNKNOWN MERCHANT LLC,33.33,,`,
  ].join('\n');
};

test('statement preview parses, guesses categories, flags deposits', async () => {
  const res = await call('/api/import/preview', { method: 'POST', body: { text: STATEMENT() } });
  assert.equal(res.status, 200);
  assert.equal(res.body.format, 'header-split');
  assert.equal(res.body.rows.length, 5);

  const s = await state();
  const kroger = res.body.rows.find((r) => /KROGER/.test(r.description));
  assert.equal(kroger.direction, 'out');
  assert.equal(kroger.amount, 82.13);
  assert.equal(kroger.category_id, byName(s.categories, 'Groceries').id);
  assert.equal(kroger.guessedBy, 'keyword');

  const speedway = res.body.rows.find((r) => /SPEEDWAY/.test(r.description));
  assert.equal(speedway.category_id, byName(s.categories, 'Fuel').id);

  const payroll = res.body.rows.find((r) => /PAYROLL/.test(r.description));
  assert.equal(payroll.direction, 'in');
  assert.equal(payroll.amount, 1502.75);

  const unknown = res.body.rows.find((r) => /UNKNOWN/.test(r.description));
  assert.equal(unknown.category_id, null, 'no guess for an unknown merchant');
});

test('committing imports rows, then a re-import skips all of them', async () => {
  const s = await state();
  const preview = await call('/api/import/preview', { method: 'POST', body: { text: STATEMENT() } });
  const rows = preview.body.rows
    .filter((r) => r.direction === 'out')
    .map((r) => ({
      date: r.date,
      description: r.description,
      amount: r.amount,
      direction: r.direction,
      category_id: r.category_id ?? byName(s.categories, 'Household & misc').id,
    }));

  const commit = await call('/api/import/commit', { method: 'POST', body: { rows } });
  assert.equal(commit.status, 201);
  assert.equal(commit.body.added, 4);
  assert.equal(commit.body.skipped, 0);
  const imported = commit.body.state.transactions.filter((t) => t.source === 'import');
  assert.equal(imported.length, 4);

  // exact same file again: everything is recognized and skipped
  const again = await call('/api/import/commit', { method: 'POST', body: { rows } });
  assert.equal(again.body.added, 0);
  assert.equal(again.body.skipped, 4);

  // and the preview now marks them as already imported
  const preview2 = await call('/api/import/preview', { method: 'POST', body: { text: STATEMENT() } });
  assert.equal(preview2.body.rows.filter((r) => r.alreadyImported).length, 4);
});

test('the import learned the corrected merchant for next time', async () => {
  const preview = await call('/api/import/preview', {
    method: 'POST',
    body: { text: `Date,Description,Withdrawals,Deposits\n${monthOf(0).slice(5, 7)}/02/${monthOf(0).slice(0, 4)},TOTALLY UNKNOWN MERCHANT LLC AGAIN X99,21.00,` },
  });
  const s = await state();
  const row = preview.body.rows[0];
  assert.equal(row.category_id, byName(s.categories, 'Household & misc').id);
  assert.equal(row.guessedBy, 'learned');
});

test('a deposit row imports as an income entry', async () => {
  const preview = await call('/api/import/preview', { method: 'POST', body: { text: STATEMENT() } });
  const dep = preview.body.rows.find((r) => r.direction === 'in');
  const commit = await call('/api/import/commit', {
    method: 'POST',
    body: { rows: [{ date: dep.date, description: dep.description, amount: dep.amount, direction: 'in' }] },
  });
  assert.equal(commit.body.addedIncome, 1);
  const entry = commit.body.state.income.entries.find((e) => e.note.includes('PAYROLL'));
  assert.ok(entry);
  assert.equal(entry.amount, 1502.75);
  await call(`/api/income/entries/${entry.id}`, { method: 'DELETE' });
});

test('garbage statements are handled gracefully', async () => {
  const empty = await call('/api/import/preview', { method: 'POST', body: { text: '   ' } });
  assert.equal(empty.status, 400);
  const junk = await call('/api/import/preview', { method: 'POST', body: { text: 'hello\nworld\nnot,a,statement' } });
  assert.equal(junk.status, 200);
  assert.equal(junk.body.rows.length, 0);
});

test('cleanup imported transactions', async () => {
  const s = await state();
  for (const t of s.transactions.filter((x) => x.source === 'import')) {
    await call(`/api/transactions/${t.id}`, { method: 'DELETE' });
  }
  assert.equal((await state()).transactions.filter((t) => t.source === 'import').length, 0);
});

// ---------------------------------------------------------------- pdf statements

function buildPdf(lines) {
  const content = ['BT /F1 10 Tf'];
  let y = 720;
  for (const line of lines) {
    content.push(`1 0 0 1 40 ${y} Tm (${line.replace(/[\\()]/g, '')}) Tj`);
    y -= 14;
  }
  content.push('ET');
  const stream = content.join('\n');
  const objs = [
    '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj',
    '2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj',
    '3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj',
    `4 0 obj << /Length ${stream.length} >> stream\n${stream}\nendstream endobj`,
    '5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj',
  ];
  let out = '%PDF-1.4\n';
  const offsets = [];
  for (const o of objs) { offsets.push(out.length); out += o + '\n'; }
  const xref = out.length;
  out += 'xref\n0 6\n0000000000 65535 f \n' +
    offsets.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('') +
    `trailer << /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(out, 'latin1');
}

test('a PDF statement previews with sections, years and directions right', async () => {
  const last = monthOf(-1);
  const mm = last.slice(5, 7);
  const yyyy = last.slice(0, 4);
  const pdf = buildPdf([
    `PNC Bank Statement   Period ${mm}/01/${yyyy} to ${mm}/28/${yyyy}`,
    'Banking/Debit Card Withdrawals and Purchases',
    `${mm}/03 KROGER #945 CINCINNATI OH 82.13`,
    `${mm}/05 SPEEDWAY 08123 HILLSBORO OH 45.00`,
    `${mm}/06 61.20 GETGO FUEL 4412 HILLSBORO`,                       // amount before description
    `${mm}/07 DOLLAR GENERAL 2210 12.50 1,204.33`,                     // trailing running balance
    `${mm}/09 AUTOZONE 4118 33.10 ${mm}/10 WENDYS 887 9.87`,           // two merged onto one line
    `${mm}/11 POS PURCHASE KROGER ${mm}/10 55.00`,                     // embedded posting date
    'Checks and Other Deductions',
    `1024 ${mm}/12 250.00`,                                            // check number before the date
    'Daily Balance Detail',
    `${mm}/01 5,000.00 ${mm}/02 4,900.00`,                             // balances, not transactions
    'Deposits and Other Additions',
    `${mm}/02 DIRECT DEP PAYROLL COMPANY 1,502.75`,
  ]);

  const res = await call('/api/import/preview', { method: 'POST', body: { pdf: pdf.toString('base64') } });
  assert.equal(res.status, 200);
  assert.equal(res.body.format, 'pdf');
  assert.equal(res.body.rows.length, 9, 'all 8 spends + 1 deposit, no balance rows');

  const s = await state();
  const kroger = res.body.rows.find((r) => /KROGER #945/.test(r.description));
  assert.equal(kroger.date, `${last}-03`, 'year inferred from the statement period');
  assert.equal(kroger.direction, 'out');
  assert.equal(kroger.amount, 82.13);
  assert.equal(byName(s.categories, 'Groceries').id, kroger.category_id);

  const getgo = res.body.rows.find((r) => /GETGO/.test(r.description));
  assert.equal(getgo.amount, 61.2, 'amount-first layout parses');
  assert.equal(getgo.category_id, byName(s.categories, 'Fuel').id);

  const dollarGeneral = res.body.rows.find((r) => /DOLLAR GENERAL/.test(r.description));
  assert.equal(dollarGeneral.amount, 12.5, 'amount taken, running balance ignored');

  const autozone = res.body.rows.find((r) => /AUTOZONE/.test(r.description));
  const wendys = res.body.rows.find((r) => /WENDYS/.test(r.description));
  assert.equal(autozone.amount, 33.1, 'first of two merged transactions');
  assert.equal(wendys.amount, 9.87, 'second of two merged transactions');
  assert.equal(wendys.date, `${last}-10`);

  const pos = res.body.rows.find((r) => /POS PURCHASE/.test(r.description));
  assert.equal(pos.date, `${last}-11`, 'embedded posting date does not split the row');
  assert.equal(pos.amount, 55);

  const check = res.body.rows.find((r) => /Check 1024/.test(r.description));
  assert.equal(check.amount, 250, 'check number before the date still parses');
  assert.equal(check.direction, 'out');

  const payroll = res.body.rows.find((r) => /PAYROLL/.test(r.description));
  assert.equal(payroll.direction, 'in', 'the deposits section flips direction');
  assert.equal(payroll.amount, 1502.75);

  assert.equal(res.body.rows.filter((r) => !r.description).length, 0, 'no empty descriptions');
});

test('a real-world savings statement: sidebars, wrapped payees, transfers, balance tables', async () => {
  const last = monthOf(-1);
  const mm = last.slice(5, 7);
  const yyyy = last.slice(0, 4);
  // Mirrors the family's actual PNC statement structure.
  const pdf = buildPdf([
    `Virtual Wallet Statement   Period ${mm}/01/${yyyy} to ${mm}/28/${yyyy}`,
    'Activity Detail',
    'Deposits and Other Additions There were 3 Deposits and Other',
    'Additions totaling $727.50.',
    'Date Amount Description',
    `${mm}/17 338.75 Online Transfer From XXXXX0922`,
    `${mm}/18 338.75 Online Transfer From XXXXX0922`,
    `${mm}/28 .01 Interest Payment`,
    'There was 1 Online or Electronic',
    'Online and Electronic Banking Deductions',
    'Banking Deduction totaling',
    'Date Amount Description',
    '$1,405.00.',
    `${mm}/22 1,405.00 Direct Payment - XXXXXX0909`,
    'Kids Country Gre XXXXXX1234',
    'Daily Balance Detail',
    'Date Balance Date Balance Date Balance',
    `${mm}/08 677.51 ${mm}/27 1,355.02 ${mm}/28 677.51`,
    `${mm}/17 1,355.01 ${mm}/22 .01`,
  ]);

  const res = await call('/api/import/preview', { method: 'POST', body: { pdf: pdf.toString('base64') } });
  assert.equal(res.status, 200);
  assert.equal(res.body.rows.length, 3, 'two transfers + one payment; no balance junk, no fragments');

  const transfers = res.body.rows.filter((r) => /Transfer From/.test(r.description));
  assert.equal(transfers.length, 2);
  for (const t2 of transfers) {
    assert.equal(t2.direction, 'in');
    assert.equal(t2.transfer, true, 'own-account transfers are flagged');
  }

  const payment = res.body.rows.find((r) => /Direct Payment/.test(r.description));
  assert.equal(payment.direction, 'out', 'the interleaved sidebar must not flip the deduction to income');
  assert.match(payment.description, /Kids Country/, 'the wrapped payee line is folded in');
  const s = await state();
  assert.equal(payment.category_id, byName(s.categories, 'Child care (Kids Country)').id,
    'the merged description is enough to auto-categorize');
  assert.equal(payment.transfer, false);

  assert.equal(res.body.rows.filter((r) => !/[A-Za-z]/.test(r.description)).length, 0, 'no wordless rows');
});

test('a last-month statement imports even though the month is closed to manual edits', async (t) => {
  process.env.BACKDATE_GRACE_DAYS = '0'; // month fully closed
  t.after(() => { delete process.env.BACKDATE_GRACE_DAYS; });

  const last = monthOf(-1);
  const s = await state();
  const rows = [
    { date: `${last}-03`, description: 'KROGER #945 CLOSED MONTH', amount: 82.13, direction: 'out', category_id: groceriesId },
    { date: `${last}-05`, description: 'SPEEDWAY CLOSED MONTH', amount: 45, direction: 'out', category_id: byName(s.categories, 'Fuel').id },
  ];
  const commit = await call('/api/import/commit', { method: 'POST', body: { rows } });
  assert.equal(commit.status, 201);
  assert.equal(commit.body.added, 2);

  const past = await call(`/api/state?month=${last}`);
  assert.equal(past.body.readOnly, true, 'the month stays read-only for manual entry');
  assert.equal(byName(past.body.categories, 'Groceries').spent, 82.13);

  // manual entry into the same closed month is still refused
  const manual = await call('/api/transactions', {
    method: 'POST',
    body: { category_id: groceriesId, amount: 10, date: `${last}-10` },
  });
  assert.equal(manual.status, 409);
});

test('the month report flags last-month overspending', async () => {
  const last = monthOf(-1);
  const s = await state();
  // groceries: 82.13 spent vs 700 budget (under); force an over by importing more fuel
  const commit = await call('/api/import/commit', {
    method: 'POST',
    body: { rows: [{ date: `${last}-08`, description: 'SPEEDWAY BIG FILL', amount: 400, direction: 'out', category_id: byName(s.categories, 'Fuel').id }] },
  });
  assert.equal(commit.status, 201);

  const now = await state();
  assert.ok(now.review, 'a review appears once last month has data');
  assert.equal(now.review.month, last);
  const fuelOver = now.review.overs.find((o) => o.name === 'Fuel');
  assert.ok(fuelOver, 'fuel is flagged as over');
  assert.equal(fuelOver.spent, 445);
  assert.equal(fuelOver.over, 95); // 445 spent vs 350 budget
});

test('imported rows in a closed month can be recategorized', async (t) => {
  process.env.BACKDATE_GRACE_DAYS = '0';
  t.after(() => { delete process.env.BACKDATE_GRACE_DAYS; });

  const last = monthOf(-1);
  const s = await state();
  const commit = await call('/api/import/commit', {
    method: 'POST',
    body: { rows: [{ date: `${last}-11`, description: 'MYSTERY SHOP', amount: 20, direction: 'out', category_id: groceriesId }] },
  });
  assert.equal(commit.status, 201);
  const past = await call(`/api/state?month=${last}`);
  const tx = past.body.transactions.find((x) => x.note === 'MYSTERY SHOP');

  const fixed = await call(`/api/transactions/${tx.id}`, {
    method: 'PUT',
    body: { category_id: byName(s.categories, 'Household & misc').id },
  });
  assert.equal(fixed.status, 200, 'imported history stays correctable');
  const after = (await call(`/api/state?month=${last}`)).body.transactions.find((x) => x.id === tx.id);
  assert.equal(after.category, 'Household & misc');

  // manual rows in closed months stay locked
  const manual = await call(`/api/transactions/999999`, { method: 'PUT', body: { amount: 5 } });
  assert.equal(manual.status, 404); // (no such row; the rule itself is covered elsewhere)

  await call(`/api/transactions/${tx.id}`, { method: 'DELETE' });
});

test('imported rows in a closed month can be deleted (mistakes stay fixable)', async (t) => {
  process.env.BACKDATE_GRACE_DAYS = '0';
  t.after(() => { delete process.env.BACKDATE_GRACE_DAYS; });

  const last = monthOf(-1);
  const past = await call(`/api/state?month=${last}`);
  const imported = past.body.transactions.filter((x) => x.source === 'import');
  assert.ok(imported.length >= 3);
  for (const tx of imported) {
    const del = await call(`/api/transactions/${tx.id}`, { method: 'DELETE' });
    assert.equal(del.status, 200);
  }
  const after = await call(`/api/state?month=${last}`);
  assert.equal(after.body.transactions.length, 0);
  assert.equal((await state()).review, null, 'review goes away with the data');
});

// ---------------------------------------------------------------- savings

test('savings: add, withdraw, balance and month tally', async () => {
  const added = await call('/api/savings/entries', { method: 'POST', body: { amount: 250, note: 'leftover from July' } });
  assert.equal(added.status, 201);
  assert.equal(added.body.state.savings.balance, 250);
  assert.equal(added.body.state.savings.thisMonth, 250);

  const out = await call('/api/savings/entries', { method: 'POST', body: { amount: 60, direction: 'out', note: 'brake pads' } });
  assert.equal(out.body.state.savings.balance, 190);
  assert.equal(out.body.state.savings.thisMonth, 190);
  assert.equal(out.body.state.savings.entries[0].amount, -60);

  const bad = await call('/api/savings/entries', { method: 'POST', body: { amount: -5 } });
  assert.equal(bad.status, 400);

  const gone1 = await call(`/api/savings/entries/${added.body.id}`, { method: 'DELETE' });
  const outId = out.body.state.savings.entries[0].id;
  const gone2 = await call(`/api/savings/entries/${outId}`, { method: 'DELETE' });
  assert.equal(gone1.status, 200);
  assert.equal(gone2.body.state.savings.balance, 0);
});

test('the savings goal is settable and survives in state', async () => {
  const set = await call('/api/savings/target', { method: 'PUT', body: { amount: 150 } });
  assert.equal(set.status, 200);
  assert.equal(set.body.state.savings.target, 150);
  const neg = await call('/api/savings/target', { method: 'PUT', body: { amount: -10 } });
  assert.equal(neg.status, 400);
  const clear = await call('/api/savings/target', { method: 'PUT', body: { amount: 0 } });
  assert.equal(clear.body.state.savings.target, 0);
});

// ---------------------------------------------------------------- savings goals

test('goals: create, fund, progress, delete keeps the money', async () => {
  const goal = await call('/api/savings/goals', { method: 'POST', body: { name: 'Christmas', target: 600 } });
  assert.equal(goal.status, 201);
  const g = goal.body.state.savings.goals.find((x) => x.name === 'Christmas');
  assert.equal(g.target, 600);
  assert.equal(g.saved, 0);

  const put = await call('/api/savings/entries', { method: 'POST', body: { amount: 150, goal_id: g.id, note: 'first' } });
  const funded = put.body.state.savings.goals.find((x) => x.id === g.id);
  assert.equal(funded.saved, 150);
  assert.equal(funded.pct, 25);
  assert.equal(put.body.state.savings.balance, 150, 'goal money counts in the overall balance');

  const renamed = await call(`/api/savings/goals/${g.id}`, { method: 'PUT', body: { target: 300 } });
  assert.equal(renamed.body.state.savings.goals.find((x) => x.id === g.id).pct, 50);

  const del = await call(`/api/savings/goals/${g.id}`, { method: 'DELETE' });
  assert.equal(del.status, 200);
  assert.equal(del.body.state.savings.goals.length, 0);
  assert.equal(del.body.state.savings.balance, 150, 'deleting a goal never deletes money');

  // unknown goal on an entry is refused
  const badEntry = await call('/api/savings/entries', { method: 'POST', body: { amount: 10, goal_id: 424242 } });
  assert.equal(badEntry.status, 404);

  // cleanup
  const s = await state();
  for (const e of s.savings.entries) await call(`/api/savings/entries/${e.id}`, { method: 'DELETE' });
});

// ---------------------------------------------------------------- restore (undo)

test('a deleted transaction can be restored, even an imported one in a closed month', async (t) => {
  process.env.BACKDATE_GRACE_DAYS = '0';
  t.after(() => { delete process.env.BACKDATE_GRACE_DAYS; });

  const last = monthOf(-1);
  const commit = await call('/api/import/commit', {
    method: 'POST',
    body: { rows: [{ date: `${last}-09`, description: 'RESTORE ME', amount: 12.5, direction: 'out', category_id: groceriesId }] },
  });
  assert.equal(commit.body.added, 1);
  // the commit reply carries the current month; the row lives in last month
  const tx = (await call(`/api/state?month=${last}`)).body.transactions.find((x) => x.note === 'RESTORE ME');
  assert.ok(tx, 'imported row found in last month');

  const del = await call(`/api/transactions/${tx.id}`, { method: 'DELETE' });
  assert.equal(del.status, 200);

  const restored = await call('/api/transactions/restore', {
    method: 'POST',
    body: { category_id: groceriesId, amount: 12.5, note: 'RESTORE ME', person: tx.person, date: `${last}-09`, source: 'import' },
  });
  assert.equal(restored.status, 201);
  const back = restored.body.state.transactions.find((x) => x.note === 'RESTORE ME');
  assert.ok(back);
  assert.equal(back.source, 'import');

  await call(`/api/transactions/${back.id}`, { method: 'DELETE' });
});

test('a deleted income entry can be restored', async () => {
  const made = await call('/api/income/entries', { method: 'POST', body: { amount: 77, label: 'undo me' } });
  await call(`/api/income/entries/${made.body.id}`, { method: 'DELETE' });
  const restored = await call('/api/income/entries/restore', {
    method: 'POST',
    body: { amount: 77, label: 'undo me', person: 'Chris', date: (await state()).today },
  });
  assert.equal(restored.status, 201);
  const back = restored.body.state.income.entries.find((e) => e.label === 'undo me');
  assert.equal(back.amount, 77);
  await call(`/api/income/entries/${back.id}`, { method: 'DELETE' });
});

// ---------------------------------------------------------------- push

test('push: vapid key, subscribe, unsubscribe', async () => {
  const key = await call('/api/push/vapid-key');
  assert.equal(key.status, 200);
  assert.ok(key.body.key.length > 60);
  const key2 = await call('/api/push/vapid-key');
  assert.equal(key2.body.key, key.body.key, 'the key is stable across calls');

  const sub = await call('/api/push/subscribe', {
    method: 'POST',
    body: { subscription: { endpoint: 'https://push.example/abc123', keys: { p256dh: 'x', auth: 'y' } } },
  });
  assert.equal(sub.status, 201);

  const junk = await call('/api/push/subscribe', { method: 'POST', body: { subscription: { endpoint: 'http://insecure' } } });
  assert.equal(junk.status, 400);

  const bye = await call('/api/push/unsubscribe', { method: 'POST', body: { endpoint: 'https://push.example/abc123' } });
  assert.equal(bye.status, 200);
});

test('the due-bill digest counts unpaid bills, by paycheck or calendar day', async () => {
  const { computeDueDigest } = require('../src/push');
  const s = await state();

  // A bill on no schedule never nags.
  const made = await call('/api/categories', {
    method: 'POST', body: { name: 'Quiet bill', kind: 'fixed', budget: 20 },
  });
  const before = computeDueDigest(db);
  assert.ok(!before || !before.body.includes('Quiet bill'), 'an unscheduled bill stays quiet');
  await call(`/api/categories/${made.body.id}`, { method: 'DELETE' });

  // A calendar bill due today makes the digest, and paying it clears it.
  const gas = byName(s.categories, 'Natural gas');
  const dayToday = Number(s.today.slice(8, 10));
  await call(`/api/categories/${gas.id}`, { method: 'PUT', body: { due_day: dayToday } });
  const digest = computeDueDigest(db);
  assert.ok(digest, 'a bill due today makes the digest');
  assert.match(digest.body, /Natural gas/);

  await call(`/api/bills/${gas.id}/pay`, { method: 'POST', body: { paid: true } });
  const after = computeDueDigest(db);
  assert.ok(!after || !after.body.includes('Natural gas'), 'paying it clears it from the digest');

  await call(`/api/bills/${gas.id}/pay`, { method: 'POST', body: { paid: false } });
  await call(`/api/categories/${gas.id}`, { method: 'PUT', body: { due_payday: 1 } });
});

test('the review counts pending suggestions for its accept button', async (t) => {
  t.after(() => { delete process.env.BACKDATE_GRACE_DAYS; });
  process.env.BACKDATE_GRACE_DAYS = await openGrace();

  const last = monthOf(-1);
  const spend = await call('/api/transactions', {
    method: 'POST',
    body: { category_id: groceriesId, amount: 843.4, date: `${last}-15` },
  });
  const s = await state();
  assert.ok(s.review, 'review present');
  assert.ok(s.review.suggestionCount >= 1, 'the groceries suggestion is counted');
  await call(`/api/transactions/${spend.body.id}`, { method: 'DELETE' });
});

// ---------------------------------------------------------------- budget tune-up

test('suggestions never propose spending more than income (Ramsey rule)', async (t) => {
  t.after(() => { delete process.env.BACKDATE_GRACE_DAYS; });
  process.env.BACKDATE_GRACE_DAYS = await openGrace();

  // seed a hot month: groceries way past plan
  const last = monthOf(-1);
  const spend = await call('/api/transactions', {
    method: 'POST',
    body: { category_id: groceriesId, amount: 843.4, date: `${last}-15`, note: 'past month total' },
  });
  assert.equal(spend.status, 201);

  const res = await call('/api/budget/suggestions');
  assert.equal(res.status, 200);
  assert.ok(['fits', 'cut'].includes(res.body.mode));

  // THE rule: bills + everyday + savings goal never exceeds income
  const t2 = res.body.totals;
  assert.ok(t2.ifAllApplied + t2.savingsGoal <= t2.income + 0.01,
    `plan $${t2.ifAllApplied} + savings $${t2.savingsGoal} must fit under income $${t2.income}`);

  const g = res.body.suggestions.find((x) => x.name === 'Groceries');
  if (g) {
    assert.equal(g.essential, true, 'groceries are four-walls protected');
    assert.ok(g.suggested <= Math.max(g.average ?? 0, g.current), 'never suggests spending more than reality');
  }
  // in cut mode, lifestyle categories carry the cuts
  if (res.body.mode === 'cut') {
    const lifestyleCuts = res.body.suggestions.filter((x) => !x.essential && x.delta < 0);
    assert.ok(lifestyleCuts.length > 0, 'cut mode trims lifestyle categories');
  }

  // the package applies as a whole (cuts + essential adjustments together)
  if (res.body.suggestions.length) {
    const before = await state();
    const originals = res.body.suggestions.map((x) => ({
      category_id: x.category_id,
      budget: byName(before.categories, x.name).budget === undefined ? x.current : x.current,
    }));
    const apply = await call('/api/budget/apply', {
      method: 'POST',
      body: { changes: res.body.suggestions.map((x) => ({ category_id: x.category_id, budget: x.suggested })) },
    });
    assert.equal(apply.status, 200, JSON.stringify(apply.body).slice(0, 120));
    const past = await call(`/api/state?month=${last}`);
    assert.equal(byName(past.body.categories, 'Groceries').budget, 700, 'history unchanged');
    // cherry-picking only the increases would break the rule — and is blocked
    const increases = res.body.suggestions.filter((x) => x.delta > 0);
    if (increases.length) {
      const undoCuts = await call('/api/budget/apply', {
        method: 'POST',
        body: { changes: originals.filter((o) => res.body.suggestions.find((x) => x.category_id === o.category_id && x.delta < 0)) },
      });
      assert.equal(undoCuts.status, 400, 'restoring old lifestyle budgets on top of raised essentials must not fit');
    }
    // full restore
    const restore = await call('/api/budget/apply', { method: 'POST', body: { changes: originals } });
    assert.ok([200, 400].includes(restore.status));
    if (restore.status === 400) {
      // restore in a fitting order: cuts first, then raises
      for (const o of originals.sort((a, b) => a.budget - b.budget)) {
        await call('/api/budget/apply', { method: 'POST', body: { changes: [o] } }).catch(() => {});
      }
    }
    for (const o of originals) {
      await call(`/api/categories/${o.category_id}`, { method: 'PUT', body: { budget: o.budget } });
    }
  }

  await call(`/api/transactions/${spend.body.id}`, { method: 'DELETE' });
});

test('the zero-based guard blocks raising budgets above income', async () => {
  const s = await state();
  const g = byName(s.categories, 'Groceries');
  const res = await call('/api/budget/apply', {
    method: 'POST',
    body: { changes: [{ category_id: g.id, budget: 99999 }] },
  });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /more than you make/);
  assert.equal(byName((await state()).categories, 'Groceries').budget, g.budget, 'nothing changed');
});

test('the Ramsey coach reports baby steps and percentage bands', async () => {
  const res = await call('/api/plan/coach');
  assert.equal(res.status, 200);
  assert.equal(res.body.steps.length, 7);
  assert.ok(res.body.currentStep >= 1);
  const step2 = res.body.steps.find((x) => x.n === 2);
  assert.equal(step2.snowball.length, 5, 'all settlement debts in the snowball');
  assert.match(step2.snowball[0].label, /LAWSUIT/i, 'the lawsuit outranks the snowball order');
  const balances = step2.snowball.slice(1).map((d) => d.balance);
  assert.deepEqual(balances, balances.slice().sort((a, b) => a - b), 'then smallest balance first');

  const giving = res.body.bands.find((b) => b.group === 'Giving');
  assert.equal(giving.pct, 10, 'the tithe holds the line at exactly 10%');
  assert.equal(giving.status, 'ok');
  assert.ok(res.body.bands.find((b) => b.group === 'Food'));
});


test('budget apply validates its input', async () => {
  const bad1 = await call('/api/budget/apply', { method: 'POST', body: { changes: [] } });
  assert.equal(bad1.status, 400);
  const bad2 = await call('/api/budget/apply', {
    method: 'POST',
    body: { changes: [{ category_id: 99999, budget: 100 }] },
  });
  assert.equal(bad2.status, 404);
});

// ---------------------------------------------------------------- realtime

test('the version stamp changes on every write', async () => {
  const before = await call('/api/version');
  await call('/api/transactions', { method: 'POST', body: { category_id: groceriesId, amount: 3.5 } });
  const after = await call('/api/version');
  assert.notEqual(before.body.version, after.body.version);
  assert.equal(after.body.by, 'Chris');
});

test('SSE pushes a change event to the other phone', async () => {
  const controller = new AbortController();
  const res = await fetch(`${base()}/api/events?token=${encodeURIComponent(token)}`, {
    signal: controller.signal,
  });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/event-stream/);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const readFrame = async () => {
    const { value, done } = await reader.read();
    return done ? '' : decoder.decode(value);
  };

  await readFrame(); // the initial snapshot frame

  await call('/api/transactions', { method: 'POST', body: { category_id: groceriesId, amount: 7.25, note: 'push' } });

  let pushed = '';
  for (let i = 0; i < 5 && !pushed.includes('transaction:add'); i++) {
    pushed += await readFrame();
  }
  assert.match(pushed, /event: change/);
  assert.match(pushed, /transaction:add/);
  controller.abort();
});

test('SSE refuses an unauthenticated listener', async () => {
  const res = await fetch(`${base()}/api/events`);
  assert.equal(res.status, 401);
  await res.json().catch(() => null);
});

// ---------------------------------------------------------------- static shell

test('the PWA shell is served', async () => {
  for (const [pathname, needle] of [
    ['/', 'Lattimer Family Budget'],
    ['/manifest.json', '"short_name": "Family Budget"'],
    ['/sw.js', 'lfb-v22'],
    ['/app.js', 'quickAddSave'],
    ['/styles.css', '--ink'],
  ]) {
    const res = await fetch(base() + pathname);
    assert.equal(res.status, 200, `${pathname} should be served`);
    assert.match(await res.text(), new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('a deep link falls back to the shell, unknown API routes do not', async () => {
  const deep = await fetch(base() + '/history');
  assert.equal(deep.status, 200);
  assert.match(await deep.text(), /<title>Lattimer Family Budget<\/title>/);

  const ghost = await call('/api/nope');
  assert.equal(ghost.status, 404);
});

test('healthz reports ok', async () => {
  const res = await fetch(base() + '/healthz');
  assert.equal(res.status, 200);
  assert.equal((await res.json()).ok, true);
});

// ------------------------------------------------- offline sync, reconciliation, backups

const shiftDay = (iso, n) =>
  new Date(Date.parse(iso + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const usDate = (iso) => `${iso.slice(5, 7)}/${iso.slice(8, 10)}/${iso.slice(0, 4)}`;

test('a client_id makes Quick Add idempotent (offline retries)', async () => {
  const s = await state();
  const groceries = byName(s.categories, 'Groceries');
  const body = { category_id: groceries.id, amount: 91.73, client_id: 'phone-q-1' };

  const first = await call('/api/transactions', { method: 'POST', body });
  assert.equal(first.status, 201);
  const retry = await call('/api/transactions', { method: 'POST', body });
  assert.equal(retry.status, 200);
  assert.equal(retry.body.deduped, true);
  assert.equal(retry.body.id, first.body.id);
  assert.equal(retry.body.state.transactions.filter((t) => t.amount === 91.73).length, 1);
  await call(`/api/transactions/${first.body.id}`, { method: 'DELETE' });
});

test('a client_id makes income logging idempotent too', async () => {
  const body = { amount: 55.51, label: 'Odd job', client_id: 'phone-q-2' };
  const first = await call('/api/income/entries', { method: 'POST', body });
  assert.equal(first.status, 201);
  const retry = await call('/api/income/entries', { method: 'POST', body });
  assert.equal(retry.status, 200);
  assert.equal(retry.body.deduped, true);
  assert.equal(retry.body.id, first.body.id);
  await call(`/api/income/entries/${first.body.id}`, { method: 'DELETE' });
});

test('import preview flags statement rows already logged by hand (±3 days)', async () => {
  const s = await state();
  const fuel = byName(s.categories, 'Fuel');
  // A hand-logged fill-up; the bank posts it two days later.
  const logged = shiftDay(s.today, -2);
  const tx = await call('/api/transactions', {
    method: 'POST',
    body: { category_id: fuel.id, amount: 47.36, date: logged, note: 'gas station' },
  });
  assert.equal(tx.status, 201);

  const csv = 'Date,Description,Withdrawals,Deposits\n' +
    `${usDate(s.today)},SHELL SERVICE STATION 4412,47.36,\n` +
    `${usDate(shiftDay(s.today, -10))},SHELL SERVICE STATION 4412,47.36,`;
  const preview = await call('/api/import/preview', { method: 'POST', body: { text: csv } });
  assert.equal(preview.status, 200);

  const near = preview.body.rows.find((r) => r.date === s.today);
  assert.equal(near.maybeManual, true, 'two days out is within the match window');
  assert.equal(near.match.date, logged);
  assert.ok(near.match.label.includes('Fuel'));

  const far = preview.body.rows.find((r) => r.date !== s.today);
  assert.equal(far.maybeManual, false, 'ten days out is not a match');

  await call(`/api/transactions/${tx.body.id}`, { method: 'DELETE' });
});

test('import preview flags deposits already logged as income', async () => {
  const s = await state();
  const logged = shiftDay(s.today, -1);
  const entry = await call('/api/income/entries', {
    method: 'POST',
    body: { amount: 321.09, label: 'Side gig', date: logged },
  });
  assert.equal(entry.status, 201);

  const csv = 'Date,Description,Withdrawals,Deposits\n' +
    `${usDate(s.today)},MOBILE CHECK DEPOSIT,,321.09`;
  const preview = await call('/api/import/preview', { method: 'POST', body: { text: csv } });
  const dep = preview.body.rows[0];
  assert.equal(dep.direction, 'in');
  assert.equal(dep.maybeManual, true);
  assert.equal(dep.match.label, 'Side gig');

  await call(`/api/income/entries/${entry.body.id}`, { method: 'DELETE' });
});

test('accounts anchor once and follow what gets logged', async () => {
  let s = await state();
  // Two accounts ship with the budget (the business one and Liza's), both
  // anchored at zero until the family fills in the real balances.
  assert.equal(s.bank.set, true);
  assert.deepEqual(s.bank.accounts.map((a) => a.name), ['Checking', 'Two Stroke Frenzy', 'Liza']);
  const checking = s.bank.accounts[0];
  const seededTotal = s.bank.total;

  // the family fills in what checking really holds
  const anchored = await call(`/api/accounts/${checking.id}`, { method: 'PUT', body: { balance: 2500 } });
  s = anchored.body.state;
  const savings = await call('/api/accounts', { method: 'POST', body: { name: 'Savings', balance: 1200 } });
  const biz = await call('/api/accounts', { method: 'POST', body: { name: 'Two Stroke Frenzy', balance: 300.50 } });
  assert.equal(biz.status, 400, 'a duplicate account name is refused');
  s = savings.body.state;
  assert.equal(s.bank.accounts.length, 4);

  // spending and income move the account they were logged against
  const groceries = byName(s.categories, 'Groceries');
  const spend = await call('/api/transactions', {
    method: 'POST', body: { category_id: groceries.id, amount: 40, account_id: checking.id },
  });
  const bal = (st, id) => st.bank.accounts.find((a) => a.id === id).balance;
  assert.equal(bal(spend.body.state, checking.id), 2460);
  assert.equal(bal(spend.body.state, savings.body.id), 1200, 'other accounts untouched');

  const inc = await call('/api/income/entries', {
    method: 'POST', body: { amount: 100, label: 'Refund', account_id: savings.body.id },
  });
  assert.equal(bal(inc.body.state, savings.body.id), 1300);

  // an entry with no account lands in the first one
  const dflt = await call('/api/transactions', { method: 'POST', body: { category_id: groceries.id, amount: 10 } });
  assert.equal(bal(dflt.body.state, checking.id), 2450, 'checking is the household default');

  // transfers move money across without touching income or spending totals
  const spentBefore = dflt.body.state.totals.spent;
  const move = await call('/api/transfers', {
    method: 'POST', body: { from_id: savings.body.id, to_id: checking.id, amount: 200 },
  });
  assert.equal(move.status, 201);
  assert.equal(bal(move.body.state, savings.body.id), 1100);
  assert.equal(bal(move.body.state, checking.id), 2650);
  assert.equal(move.body.state.totals.spent, spentBefore, 'a transfer is not spending');
  assert.equal(move.body.state.transfers.length, 1);
  assert.equal(move.body.state.transfers[0].from, 'Savings');

  // same account both sides is refused
  const bad = await call('/api/transfers', {
    method: 'POST', body: { from_id: savings.body.id, to_id: savings.body.id, amount: 5 },
  });
  assert.equal(bad.status, 400);

  // deleting the transfer puts both balances back
  const undo = await call(`/api/transfers/${move.body.id}`, { method: 'DELETE' });
  assert.equal(bal(undo.body.state, savings.body.id), 1300);

  // re-anchoring replaces an account's number outright
  const fix = await call(`/api/accounts/${checking.id}`, { method: 'PUT', body: { balance: 3000 } });
  assert.equal(bal(fix.body.state, checking.id), 3000);

  // archiving hides the account but keeps history rows
  const bye = await call(`/api/accounts/${savings.body.id}`, { method: 'DELETE' });
  assert.equal(bye.body.state.bank.accounts.length, 3);

  // clean up entries so later tests see the usual month
  await call(`/api/transactions/${spend.body.id}`, { method: 'DELETE' });
  await call(`/api/transactions/${dflt.body.id}`, { method: 'DELETE' });
  await call(`/api/income/entries/${inc.body.id}`, { method: 'DELETE' });
});

test('the API reports its build revision so old phones can self-update', async () => {
  const APP_REV = require('../src/version');
  const v = await call('/api/version');
  assert.equal(v.body.app, APP_REV);
  const s = await state();
  assert.equal(s.app, APP_REV);
});

test('recategorizing an imported row teaches the importer for next time', async () => {
  const s = await state();
  const fuel = byName(s.categories, 'Fuel');
  const eat = byName(s.categories, 'Eating out & fun');

  const commit = await call('/api/import/commit', {
    method: 'POST',
    body: { rows: [{ date: s.today, description: 'CIRCLE K 05512', amount: 9.87, direction: 'out', category_id: fuel.id }] },
  });
  assert.equal(commit.status, 201);
  const row = commit.body.state.transactions.find((t) => t.note === 'CIRCLE K 05512');

  // the family fixes it: that stop was snacks, not fuel
  const fix = await call(`/api/transactions/${row.id}`, { method: 'PUT', body: { category_id: eat.id } });
  assert.equal(fix.status, 200);

  // the next statement with that merchant guesses the corrected category,
  // outranking the built-in gas-station keyword
  const preview = await call('/api/import/preview', {
    method: 'POST',
    body: { text: `Date,Description,Withdrawals,Deposits\n${usDate(s.today)},CIRCLE K 05512,4.50,` },
  });
  assert.equal(preview.body.rows[0].category_id, eat.id);
  assert.equal(preview.body.rows[0].guessedBy, 'learned');

  await call(`/api/transactions/${row.id}`, { method: 'DELETE' });
});

test('auto-drafts tick themselves off on the day they come out', async () => {
  const s = await state();
  const disney = byName(s.categories, 'Disney+');
  assert.equal(disney.autoPay, true, 'seeded as an auto-draft');
  assert.equal(disney.paid, false, 'the 20th has not arrived in the test month');

  // Move its due day to today: the next read pays it, at its budgeted amount.
  const dayToday = Number(s.today.slice(8, 10));
  const hit = await call(`/api/categories/${disney.id}`, { method: 'PUT', body: { due_day: dayToday } });
  const paid = byName(hit.body.state.categories, 'Disney+');
  assert.equal(paid.paid, true, 'its day arrived, so it is ticked off');
  assert.equal(paid.spent, 14);
  const tx = hit.body.state.transactions.find((t) => t.category_id === disney.id);
  assert.equal(tx.source, 'billpay');
  assert.equal(tx.person, 'Auto');
  assert.equal(tx.date, s.today);

  // Idempotent: reading again does not pay it twice.
  const again = await state();
  assert.equal(byName(again.categories, 'Disney+').spent, 14);

  // Turning auto-pay off leaves the payment alone but stops future ones.
  const off = await call(`/api/categories/${disney.id}`, { method: 'PUT', body: { auto_pay: false } });
  assert.equal(byName(off.body.state.categories, 'Disney+').autoPay, false);

  // A bill that is not an auto-draft is never touched.
  const gas = byName(s.categories, 'Natural gas');
  assert.equal(gas.autoPay, false);
  assert.equal(byName(again.categories, 'Natural gas').paid, false);

  await call(`/api/transactions/${tx.id}`, { method: 'DELETE' });
  await call(`/api/categories/${disney.id}`, { method: 'PUT', body: { due_day: 20, auto_pay: true } });
});

test('a bill remembers which account pays it', async () => {
  const s = await state();
  const daycare = byName(s.categories, 'Child care (Kids Country)');
  const liza = s.bank.accounts.find((a) => a.name === 'Liza');
  assert.ok(liza, "Liza's account exists");
  assert.equal(daycare.accountId, liza.id, 'daycare is paid from Liza\'s account');

  const before = s.bank.accounts.find((a) => a.id === liza.id).balance;
  const paid = await call(`/api/bills/${daycare.id}/pay`, { method: 'POST', body: { paid: true } });
  const after = paid.body.state.bank.accounts.find((a) => a.id === liza.id).balance;
  assert.equal(Math.round((before - after) * 100) / 100, daycare.budget, 'it came out of the right account');

  await call(`/api/bills/${daycare.id}/pay`, { method: 'POST', body: { paid: false } });
});

test('the new loans are live now and come from the business account', async () => {
  const s = await state();
  const biz = s.bank.accounts.find((a) => a.name === 'Two Stroke Frenzy');
  for (const name of ['Truck (Credit Acceptance)', 'Dirt bike (Lendmark)']) {
    const bill = byName(s.categories, name);
    assert.ok(bill, name + ' is payable now — August was paid out of pocket');
    assert.equal(bill.accountId, biz.id, name + ' is paid from the business account');
  }
  // Only the student loans are still waiting.
  assert.deepEqual((s.upcoming || []).map((c) => c.name), ["Miriam's student loans"]);
});

test('a future month tracks live settings so it can be planned', async () => {
  const nextMonth = monthOf(1);
  const before = await call(`/api/state?month=${nextMonth}`);
  assert.equal(before.status, 200);
  const startIncome = before.body.totals.income;

  // A raise (or a new side income) must show up in next month's plan, not
  // just this month's — otherwise planning ahead reads stale numbers.
  const added = await call('/api/income', {
    method: 'POST',
    body: { name: 'Side contract', amount: 500, per_month: 1, person: 'Chris' },
  });
  assert.equal(added.status, 201);

  const after = await call(`/api/state?month=${nextMonth}`);
  assert.equal(after.body.totals.income, startIncome + 500, 'next month sees the new income');

  // The tithe follows it, since it is a percent of income.
  const tithe = byName(after.body.categories, 'Church giving');
  assert.equal(tithe.budget, Math.round((startIncome + 500) * 10) / 100);

  // A past month stays frozen at whatever it was budgeted, not the new total.
  const past = await call(`/api/state?month=${monthOf(-1)}`);
  assert.notEqual(past.body.totals.income, startIncome + 500, 'history does not move');

  await call(`/api/income/${added.body.id}`, { method: 'DELETE' });
});

test('a backup snapshot is written, listed, and is a real database', async () => {
  const run = await call('/api/backup/run', { method: 'POST' });
  assert.equal(run.status, 200);
  assert.equal(run.body.ok, true);

  const status = await call('/api/backup/status');
  assert.ok(status.body.count >= 1);
  assert.match(status.body.newest.file, /^budget-\d{4}-\d{2}-\d{2}\.db$/);
  assert.ok(status.body.newest.size > 0);

  const Database = require('better-sqlite3');
  const snap = new Database(path.join(tmpDir, 'backups', status.body.newest.file), { readonly: true });
  const n = snap.prepare('SELECT COUNT(*) AS n FROM categories').get().n;
  snap.close();
  assert.ok(n > 0, 'the snapshot contains the family data');
});

test('a backup can be downloaded from the phone', async () => {
  const res = await fetch(base() + '/api/backup/download', {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(res.status, 200);
  const buf = Buffer.from(await res.arrayBuffer());
  assert.equal(buf.subarray(0, 15).toString(), 'SQLite format 3');
});
