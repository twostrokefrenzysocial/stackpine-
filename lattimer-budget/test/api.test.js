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
  assert.equal(s.categories.filter((c) => c.kind === 'fixed').length, 16);
  assert.equal(s.categories.filter((c) => c.kind === 'variable').length, 7);
  assert.equal(s.income.total, 7638);
  assert.equal(s.totals.income, 7638);
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
  assert.equal(count, 24); // 16 fixed + the scheduled student loan + 7 variable
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
  assert.equal(res.body.state.totals.remaining, 7555.53);
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
  assert.equal(afterPay.spent, 150);
  assert.equal(paid.body.state.transactions[0].source, 'billpay');

  // paying twice must not double-count
  await call(`/api/bills/${bill.id}/pay`, { method: 'POST', body: { paid: true } });
  const twice = await state();
  assert.equal(byName(twice.categories, 'Natural gas').spent, 150);

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
  assert.equal(res.body.categories.length, 23);
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

test('setting a due day shows up on the bill', async () => {
  const s = await state();
  const bill = byName(s.categories, 'Water/sewer');
  assert.equal(bill.dueDay, null);
  assert.equal(bill.dueStatus, null);

  const dayToday = Number(s.today.slice(8, 10));
  const res = await call(`/api/categories/${bill.id}`, { method: 'PUT', body: { due_day: dayToday } });
  assert.equal(res.status, 200);

  const due = byName(res.body.state.categories, 'Water/sewer');
  assert.equal(due.dueDay, dayToday);
  assert.equal(due.dueDate, s.today);
  assert.equal(due.dueIn, 0);
  assert.equal(due.dueStatus, 'today');
});

test('paying a bill clears its due warning', async () => {
  const s = await state();
  const bill = byName(s.categories, 'Water/sewer');
  assert.equal(bill.dueStatus, 'today');

  const paid = await call(`/api/bills/${bill.id}/pay`, { method: 'POST', body: { paid: true } });
  const after = byName(paid.body.state.categories, 'Water/sewer');
  assert.equal(after.paid, true);
  assert.equal(after.dueStatus, null, 'a paid bill is not still nagging');

  await call(`/api/bills/${bill.id}/pay`, { method: 'POST', body: { paid: false } });
});

test('bills with due dates sort to the top, earliest first', async () => {
  const s = await state();
  const water = byName(s.categories, 'Water/sewer');
  const electric = byName(s.categories, 'Electric');
  const gas = byName(s.categories, 'Natural gas');

  await call(`/api/categories/${water.id}`, { method: 'PUT', body: { due_day: 20 } });
  await call(`/api/categories/${electric.id}`, { method: 'PUT', body: { due_day: 5 } });
  const res = await call(`/api/categories/${gas.id}`, { method: 'PUT', body: { due_day: 12 } });

  const fixed = res.body.state.categories.filter((c) => c.kind === 'fixed');
  assert.deepEqual(
    fixed.slice(0, 3).map((c) => c.name),
    ['Electric', 'Natural gas', 'Water/sewer']
  );
  assert.equal(fixed[3].dueDay, null, 'undated bills follow the dated ones');

  // clear them again
  for (const c of [water, electric, gas]) {
    await call(`/api/categories/${c.id}`, { method: 'PUT', body: { due_day: null } });
  }
  const cleared = await state();
  assert.equal(byName(cleared.categories, 'Electric').dueDay, null);
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
  assert.equal(res.body.state.income.total, 7738);
  assert.equal(res.body.state.totals.income, 7738);
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
  assert.equal(after.spent, now.spent + 150);

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
  assert.equal(st.totals.income, 7638, 'the plan number does not move');
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
  const fundBill = byName(s.categories, 'Settlement fund');
  await call(`/api/bills/${fundBill.id}/pay`, { method: 'POST', body: { paid: true } });

  const deposit = await call('/api/fund/deposits', {
    method: 'POST',
    body: { amount: 500, note: 'Third paycheck' },
  });
  assert.equal(deposit.status, 201);
  assert.equal(deposit.body.state.fund.contributed, 150);
  assert.equal(deposit.body.state.fund.deposited, 500);
  assert.equal(deposit.body.state.fund.balance, 650);

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
  assert.equal(removedDeposit.body.state.fund.balance, 150);
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

// ---------------------------------------------------------------- budget tune-up

test('budget suggestions come from past-month actuals', async (t) => {
  t.after(() => { delete process.env.BACKDATE_GRACE_DAYS; });
  process.env.BACKDATE_GRACE_DAYS = await openGrace();

  // seed a past month: groceries ran hot
  const last = monthOf(-1);
  const spend = await call('/api/transactions', {
    method: 'POST',
    body: { category_id: groceriesId, amount: 843.4, date: `${last}-15`, note: 'past month total' },
  });
  assert.equal(spend.status, 201);

  const res = await call('/api/budget/suggestions');
  assert.equal(res.status, 200);
  assert.ok(res.body.monthsConsidered.includes(last));
  const g = res.body.suggestions.find((x) => x.name === 'Groceries');
  assert.ok(g, 'groceries should get a suggestion');
  assert.equal(g.current, 700);
  assert.equal(g.suggested, 845, 'rounded to the nearest $5');
  assert.ok(res.body.totals.income > 0);

  // categories with no history are left alone
  assert.equal(res.body.suggestions.find((x) => x.name === 'Personal - Chris'), undefined);

  // apply it
  const apply = await call('/api/budget/apply', {
    method: 'POST',
    body: { changes: [{ category_id: g.category_id, budget: g.suggested }] },
  });
  assert.equal(apply.status, 200);
  assert.equal(byName(apply.body.state.categories, 'Groceries').budget, 845);

  // past month keeps its own snapshot
  const past = await call(`/api/state?month=${last}`);
  assert.equal(byName(past.body.categories, 'Groceries').budget, 700);

  // put everything back
  await call('/api/budget/apply', { method: 'POST', body: { changes: [{ category_id: g.category_id, budget: 700 }] } });
  await call(`/api/transactions/${spend.body.id}`, { method: 'DELETE' });
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
    ['/sw.js', 'lfb-v4'],
    ['/app.js', 'quickAddSave'],
    ['/styles.css', '--navy'],
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
