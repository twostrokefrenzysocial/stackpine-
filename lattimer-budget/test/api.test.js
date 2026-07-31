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
  assert.equal(count, 23);
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

test('past months are read-only', async () => {
  const res = await call('/api/transactions', {
    method: 'POST',
    body: { category_id: groceriesId, amount: 25, date: `${monthOf(-1)}-15` },
  });
  assert.equal(res.status, 409);
});

test('a past month renders read-only with its own snapshot', async () => {
  const res = await call(`/api/state?month=${monthOf(-1)}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.readOnly, true);
  assert.equal(res.body.month, monthOf(-1));
  assert.equal(res.body.transactions.length, 0);
  assert.equal(res.body.categories.length, 23);
});

test('a malformed month is rejected', async () => {
  const res = await call('/api/state?month=not-a-month');
  assert.equal(res.status, 400);
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
    ['/sw.js', 'lfb-v1'],
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
