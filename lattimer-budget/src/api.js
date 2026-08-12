'use strict';

const express = require('express');
const {
  PEOPLE,
  TZ,
  today,
  currentMonth,
  previousMonth,
  graceDays,
  inGraceWindow,
  isWritableMonth,
  earliestWritableDate,
  lastDayOfMonth,
  weekStartOf,
  addDays,
  nextOccurrence,
  dueDateIn,
  daysUntil,
  isValidDate,
  isValidMonth,
  toCents,
  toDollars,
  makeToken,
  verifyToken,
  pinMatches,
} = require('./util');
const { SETTLEMENT_FUND_CATEGORY } = require('./seed');
const { parseStatement, merchantKey, keywordGuess, importHash } = require('./import');
const { extractLines, parsePdfLines } = require('./pdf');
const { runBackup, listBackups, snapshotForDownload } = require('./backup');
const APP_REV = require('./version');
const fs = require('fs');

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const bad = (msg) => new HttpError(400, msg);
const notFound = (msg) => new HttpError(404, msg);

function createApi(db) {
  const router = express.Router();

  // ---------------------------------------------------------------- realtime

  const clients = new Set();
  const bootId = Math.random().toString(36).slice(2, 8);
  let counter = 0;
  let lastChange = { version: `${bootId}:0`, at: new Date().toISOString(), by: '', kind: 'boot' };

  function broadcast(kind, by) {
    counter += 1;
    lastChange = { version: `${bootId}:${counter}`, at: new Date().toISOString(), by: by || '', kind };
    const frame = `event: change\ndata: ${JSON.stringify(lastChange)}\n\n`;
    for (const res of clients) {
      try {
        res.write(frame);
      } catch {
        clients.delete(res);
      }
    }
  }

  // ---------------------------------------------------------------- helpers

  const q = {
    categories: db.prepare(
      `SELECT * FROM categories WHERE archived = 0 ORDER BY kind DESC, sort_order, id`
    ),
    categoryById: db.prepare(`SELECT * FROM categories WHERE id = ?`),
    incomeSources: db.prepare(`SELECT * FROM income_sources ORDER BY sort_order, id`),
    monthRows: db.prepare(`SELECT * FROM month_budgets WHERE month = ? ORDER BY kind DESC, sort_order, name`),
    upsertMonthRow: db.prepare(`
      INSERT INTO month_budgets (month, category_id, name, kind, budget_cents, sort_order)
      VALUES (@month, @category_id, @name, @kind, @budget_cents, @sort_order)
      ON CONFLICT (month, category_id) DO UPDATE SET
        name = excluded.name,
        kind = excluded.kind,
        budget_cents = excluded.budget_cents,
        sort_order = excluded.sort_order
    `),
    // Drops rows for categories that are archived, or not yet started, unless the
    // month already has spending against them.
    deleteStaleMonthRows: db.prepare(`
      DELETE FROM month_budgets
      WHERE month = @month
        AND category_id NOT IN (
          SELECT id FROM categories
          WHERE archived = 0 AND (starts_month IS NULL OR starts_month <= @month)
        )
        AND category_id NOT IN (SELECT DISTINCT category_id FROM transactions WHERE month = @month)
    `),
    upsertMonthIncome: db.prepare(`
      INSERT INTO month_income (month, income_cents) VALUES (?, ?)
      ON CONFLICT (month) DO UPDATE SET income_cents = excluded.income_cents
    `),
    monthIncome: db.prepare(`SELECT income_cents FROM month_income WHERE month = ?`),
    spentByCategory: db.prepare(`
      SELECT category_id, SUM(amount_cents) AS spent
      FROM transactions WHERE month = ? GROUP BY category_id
    `),
    txForMonth: db.prepare(`
      SELECT t.*, c.name AS category, c.kind AS category_kind
      FROM transactions t JOIN categories c ON c.id = t.category_id
      WHERE t.month = ?
      ORDER BY t.date DESC, t.id DESC
    `),
    txById: db.prepare(`SELECT * FROM transactions WHERE id = ?`),
    months: db.prepare(`
      SELECT month FROM (
        SELECT DISTINCT month FROM transactions
        UNION SELECT month FROM month_budgets
        UNION SELECT DISTINCT month FROM income_entries
      ) ORDER BY month DESC
    `),
    billPaidRows: db.prepare(`
      SELECT category_id, SUM(amount_cents) AS paid_cents, COUNT(*) AS n,
             MAX(person) AS who, MAX(date) AS last_date
      FROM transactions WHERE month = ? AND source = 'billpay' GROUP BY category_id
    `),
    incomeEntriesForMonth: db.prepare(`
      SELECT * FROM income_entries WHERE month = ? ORDER BY date DESC, id DESC
    `),
    incomeEntryById: db.prepare(`SELECT * FROM income_entries WHERE id = ?`),
    receivedBySource: db.prepare(`
      SELECT source_id, SUM(amount_cents) AS total, COUNT(*) AS n
      FROM income_entries WHERE month = ? GROUP BY source_id
    `),
    debts: db.prepare(`SELECT * FROM debts ORDER BY settled, sort_order, id`),
    debtById: db.prepare(`SELECT * FROM debts WHERE id = ?`),
    deposits: db.prepare(`SELECT * FROM fund_deposits ORDER BY date DESC, id DESC`),
    fundContributions: db.prepare(`
      SELECT COALESCE(SUM(t.amount_cents), 0) AS total
      FROM transactions t JOIN categories c ON c.id = t.category_id
      WHERE c.name = ?
    `),
    settledTotal: db.prepare(
      `SELECT COALESCE(SUM(settled_cents), 0) AS total FROM debts WHERE settled = 1`
    ),
  };

  function liveIncomeCents() {
    return q
      .incomeSources
      .all()
      .reduce((sum, s) => sum + s.amount_cents * s.per_month, 0);
  }

  /** Every distinct payday date falling inside a month, across all sources. */
  function paydaysInMonth(month) {
    const monthEnd = lastDayOfMonth(month);
    const dates = new Set();
    for (const s of q.incomeSources.all()) {
      if (!s.next_date) continue;
      let d = nextOccurrence(s.next_date, s.cadence || 'biweekly', `${month}-01`);
      let guard = 0;
      while (d && d <= monthEnd && guard++ < 10) {
        if (d >= `${month}-01`) dates.add(d);
        // next occurrence strictly after d, keeping the original anchor
        d = nextOccurrence(s.next_date, s.cadence || 'biweekly', addDays(d, 1));
      }
    }
    return [...dates].sort();
  }

  /** How many payments a per-payday bill makes in a month (at least one). */
  function paydayCount(month) {
    return Math.max(1, paydaysInMonth(month).length);
  }

  /**
   * The pay period a date falls in: from the paycheck that started it up to
   * (not including) the next one. Only real paychecks — weekly or biweekly
   * sources — define the boundaries; a monthly contract payment landing
   * mid-period must not chop the period in two.
   */
  function payPeriodFor(dayIso) {
    const checks = q.incomeSources.all()
      .filter((s) => s.next_date && ['weekly', 'biweekly'].includes(s.cadence || 'biweekly'));
    const dates = new Set();
    for (const s of checks) {
      const cad = s.cadence || 'biweekly';
      let d = nextOccurrence(s.next_date, cad, addDays(dayIso, -60));
      let guard = 0;
      while (d && d <= addDays(dayIso, 60) && guard++ < 40) {
        dates.add(d);
        d = nextOccurrence(s.next_date, cad, addDays(d, 1));
      }
    }
    const all = [...dates].sort();
    const started = all.filter((x) => x <= dayIso);
    const coming = all.filter((x) => x > dayIso);
    const month = dayIso.slice(0, 7);
    const start = started.length ? started[started.length - 1] : `${month}-01`;
    const end = coming.length ? coming[0] : addDays(lastDayOfMonth(month), 1);
    const inMonth = paydaysInMonth(month);
    return {
      start,
      end,                                  // exclusive
      last: addDays(end, -1),               // last day money counts to
      count: Math.max(1, inMonth.length),   // paychecks in this month
      index: Math.max(1, inMonth.filter((x) => x <= start).length),
    };
  }

  /**
   * The family pays bills when a check lands, not on the due date, and the
   * big ones run every 28 days — so each payday alternates between two sets
   * of bills. Parity 0/1 is measured in fortnights from the earliest payday
   * anchor, so it stays stable month after month.
   */
  function paydayParity(date) {
    const anchors = q.incomeSources.all().map((s) => s.next_date).filter(Boolean).sort();
    if (!anchors.length) return 0;
    const days = Math.round((Date.parse(date + 'T12:00:00Z') - Date.parse(anchors[0] + 'T12:00:00Z')) / 86400000);
    return ((Math.round(days / 14) % 2) + 2) % 2;
  }

  /** This month's paydays, each tagged with which bill group it pays. */
  function paydaysWithParity(month) {
    return paydaysInMonth(month).map((d) => ({ date: d, parity: paydayParity(d) }));
  }

  /** A category's monthly budget in cents, honouring payday and percent bills. */
  function monthlyBudgetCents(c, month) {
    // Percent-of-income bills (the tithe) follow expected net income.
    if (c.percent_income) return Math.round((c.percent_income / 100) * liveIncomeCents());
    // Per-payday bills budget their per-payment amount times the month's
    // paydays: $200 → $400 normally, $600 in a three-check month.
    if (c.cadence === 'payday') return c.budget_cents * paydayCount(month);
    return c.budget_cents;
  }

  /** Keep the current month's snapshot in step with live settings. */
  const syncCurrentMonth = db.transaction((month) => {
    for (const c of q.categories.all()) {
      // A bill scheduled to begin later stays off the budget until its month.
      if (c.starts_month && c.starts_month > month) continue;
      const budget = monthlyBudgetCents(c, month);
      q.upsertMonthRow.run({
        month,
        category_id: c.id,
        name: c.name,
        kind: c.kind,
        budget_cents: budget,
        sort_order: c.sort_order,
      });
    }
    q.deleteStaleMonthRows.run({ month });
    q.upsertMonthIncome.run(month, liveIncomeCents());
  });

  /**
   * Auto-drafts pay themselves at the bank, so the app ticks them off on the
   * day they come out instead of waiting to be tapped. Idempotent: a bill
   * that already has a payment this month is left alone.
   */
  function autoPayDueBills(month) {
    if (month !== currentMonth()) return; // never back-fill a closed month
    const day = today();
    const due = db.prepare(`
      SELECT * FROM categories
      WHERE kind = 'fixed' AND archived = 0 AND auto_pay = 1 AND due_day IS NOT NULL
        AND (starts_month IS NULL OR starts_month <= ?)
    `).all(month);
    if (!due.length) return;

    const now = new Date().toISOString();
    for (const c of due) {
      const dueDate = dueDateIn(month, c.due_day);
      if (dueDate > day) continue;
      const already = db.prepare(`
        SELECT COUNT(*) AS n FROM transactions WHERE month = ? AND category_id = ?
      `).get(month, c.id).n;
      if (already) continue;
      const snapshot = db
        .prepare(`SELECT budget_cents FROM month_budgets WHERE month = ? AND category_id = ?`)
        .get(month, c.id);
      const amount = snapshot?.budget_cents ?? c.budget_cents;
      if (amount <= 0) continue;
      db.prepare(`
        INSERT INTO transactions (category_id, amount_cents, note, person, date, month, source, created_at, updated_at, account_id)
        VALUES (?, ?, 'Auto-draft', 'Auto', ?, ?, 'billpay', ?, ?, ?)
      `).run(c.id, amount, dueDate, month, now, now, accountForBill(c));
    }
  }

  /**
   * The current month and any month still ahead track live settings, so a
   * plan being made for next month picks up a new income source or budget.
   * Only a month already in the past is frozen at what it was budgeted.
   */
  function ensureMonth(month) {
    if (month >= currentMonth()) {
      syncCurrentMonth(month);
      return;
    }
    if (q.monthRows.all(month).length === 0) syncCurrentMonth(month);
  }

  function fundBalanceCents() {
    const contributed = q.fundContributions.get(SETTLEMENT_FUND_CATEGORY)?.total ?? 0;
    const deposited = q.deposits.all().reduce((s, d) => s + d.amount_cents, 0);
    const spent = q.settledTotal.get().total;
    return { contributed, deposited, spent, balance: contributed + deposited - spent };
  }

  function statusFor(pct) {
    if (pct > 100) return 'over';
    if (pct >= 80) return 'warn';
    return 'ok';
  }

  const activeAccounts = () =>
    db.prepare(`SELECT * FROM accounts WHERE archived = 0 ORDER BY sort_order, id`).all();

  /** The account new entries land in when none is chosen. */
  function primaryAccountId() {
    return activeAccounts()[0]?.id ?? null;
  }

  /**
   * A bill's account. An external bill deliberately belongs to no tracked
   * account — account 0 exists nowhere, so its payments count as spending
   * without moving any balance. Otherwise fall back to the primary account
   * if the assigned one has been removed.
   */
  function accountForBill(category) {
    if (category.external) return null;   // no tracked account, by design
    if (!category.account_id) return primaryAccountId();
    const live = db.prepare(`SELECT id FROM accounts WHERE id = ? AND archived = 0`).get(category.account_id);
    return live ? live.id : primaryAccountId();
  }

  function readAccount(value) {
    if (value === undefined || value === null || value === '') return primaryAccountId();
    const id = Number(value);
    const row = db.prepare(`SELECT id FROM accounts WHERE id = ? AND archived = 0`).get(id);
    if (!row) throw bad('That account no longer exists.');
    return row.id;
  }

  /**
   * "What's in the bank", per account: each is anchored to its real balance
   * once, and every dollar logged after that moves it — income up, spending
   * down, transfers across. Entries dated before the anchor (or created
   * before it was set) are already inside the anchored number, so they never
   * count twice. Legacy rows without an account belong to the first one.
   */
  /**
   * An account's balance: its anchor plus everything logged against it since.
   * A row with no account belongs to no tracked balance at all — that is how
   * a bill paid from an account the family does not track stays a real cost
   * without moving any balance here.
   */
  function accountBalanceCents(a) {
    const inC = db.prepare(
      `SELECT COALESCE(SUM(amount_cents), 0) AS n FROM income_entries
       WHERE account_id = ? AND date >= ? AND created_at > ?`
    ).get(a.id, a.anchor_date, a.anchor_at).n;
    const outC = db.prepare(
      `SELECT COALESCE(SUM(amount_cents), 0) AS n FROM transactions
       WHERE account_id = ? AND date >= ? AND created_at > ?`
    ).get(a.id, a.anchor_date, a.anchor_at).n;
    const tIn = db.prepare(
      `SELECT COALESCE(SUM(amount_cents), 0) AS n FROM transfers WHERE to_id = ? AND date >= ? AND created_at > ?`
    ).get(a.id, a.anchor_date, a.anchor_at).n;
    const tOut = db.prepare(
      `SELECT COALESCE(SUM(amount_cents), 0) AS n FROM transfers WHERE from_id = ? AND date >= ? AND created_at > ?`
    ).get(a.id, a.anchor_date, a.anchor_at).n;
    return a.anchor_cents + inC - outC + tIn - tOut;
  }

  function bankState() {
    const rows = activeAccounts().map((a) => ({
      id: a.id,
      name: a.name,
      balance: toDollars(accountBalanceCents(a)),
      asOf: a.anchor_date,
    }));
    return {
      set: rows.length > 0,
      accounts: rows,
      total: toDollars(rows.reduce((s, r) => s + Math.round(r.balance * 100), 0)),
    };
  }

  function buildState(month, person) {
    ensureMonth(month);
    autoPayDueBills(month);

    const spentMap = new Map(q.spentByCategory.all(month).map((r) => [r.category_id, r.spent]));
    const paidMap = new Map(q.billPaidRows.all(month).map((r) => [r.category_id, r]));

    // Everyday budgets are tracked per paycheck, not per month: the family is
    // paid biweekly and thinks in paycheck-sized chunks. A past month has no
    // "current" period, so it falls back to the whole month.
    const period = month === currentMonth()
      ? payPeriodFor(today())
      : { start: `${month}-01`, end: addDays(lastDayOfMonth(month), 1), last: lastDayOfMonth(month), count: 1, index: 1 };
    const periodSpent = new Map(db.prepare(`
      SELECT category_id, SUM(amount_cents) AS spent FROM transactions
      WHERE date >= ? AND date < ? GROUP BY category_id
    `).all(period.start, period.end).map((r) => [r.category_id, r.spent]));
    const live = q.categories.all();
    const liveIds = new Set(live.map((c) => c.id));
    // Bills that have not started yet: shown in Settings so they can be planned
    // for, kept off this month's dashboard and totals.
    const upcoming = live
      .filter((c) => c.starts_month && c.starts_month > month)
      .map((c) => ({
        id: c.id,
        name: c.name,
        kind: c.kind,
        budget: toDollars(c.budget_cents),
        startsMonth: c.starts_month,
        dueDay: c.due_day ?? null,
      }));

    const dueDays = new Map(live.filter((c) => c.due_day).map((c) => [c.id, c.due_day]));
    const liveById = new Map(live.map((c) => [c.id, c]));
    const isCurrent = month === currentMonth();
    const monthPaydayRows = paydaysWithParity(month);
    const monthPaydays = monthPaydayRows.map((p) => p.date);
    const receivedSoFarCents = db
      .prepare(`SELECT COALESCE(SUM(amount_cents), 0) AS n FROM income_entries WHERE month = ?`)
      .get(month).n;

    const categories = q.monthRows.all(month).map((row) => {
      const spent = spentMap.get(row.category_id) ?? 0;
      const budget = row.budget_cents;
      const pct = budget > 0 ? (spent / budget) * 100 : spent > 0 ? 101 : 0;
      const paidRow = paidMap.get(row.category_id);
      const liveCat = liveById.get(row.category_id);
      const isPayday = liveCat?.cadence === 'payday' && row.kind === 'fixed';

      // Per-payday bills complete over several payments in the month. A plain
      // bill also counts as handled when hand-logged spending covers it (a
      // subscription logged through Quick Add is that bill, paid).
      const expected = isPayday ? Math.max(1, monthPaydays.length) : 1;
      const paidCount = paidRow ? paidRow.n : 0;
      const fullyPaid = isPayday
        ? paidCount >= expected
        : Boolean(paidRow) || (row.kind === 'fixed' && budget > 0 && spent >= budget);

      // Due-date state, only meaningful for an unpaid bill in the live month.
      const dueDay = dueDays.get(row.category_id) ?? null;
      const duePayday = liveCat?.due_payday ?? null;
      let dueDate = dueDay ? dueDateIn(month, dueDay) : null;
      // Bills the family pays by hand land on their paycheck, not a calendar
      // day: pick this month's payday belonging to that bill's group.
      if (duePayday !== null) {
        const mine = monthPaydayRows.filter((p) => p.parity === duePayday).map((p) => p.date);
        dueDate = mine.find((dt) => dt >= today()) ?? mine[0] ?? null;
      }
      if (isPayday) dueDate = monthPaydays[Math.min(paidCount, monthPaydays.length - 1)] ?? null;
      let dueIn = null;
      let dueStatus = null;
      if (dueDate && isCurrent && !fullyPaid) {
        dueIn = daysUntil(dueDate);
        dueStatus = dueIn < 0 ? 'overdue' : dueIn === 0 ? 'today' : dueIn <= 3 ? 'soon' : 'later';
      }

      // Percent-of-income bills owe a share of what has actually come in.
      const pctIncome = liveCat?.percent_income ?? null;
      const dueNowCents = pctIncome
        ? Math.max(0, Math.round((pctIncome / 100) * receivedSoFarCents) - (paidRow?.paid_cents ?? 0))
        : null;

      return {
        id: row.category_id,
        name: row.name,
        kind: row.kind,
        cadence: isPayday ? 'payday' : null,
        percent: pctIncome,
        dueNow: pctIncome ? toDollars(dueNowCents) : null,
        perPay: isPayday
          ? toDollars(pctIncome ? Math.round(row.budget_cents / expected) : liveCat.budget_cents)
          : null,
        expected: isPayday ? expected : null,
        paidCount,
        dueDay,
        duePayday,
        autoPay: Boolean(liveCat?.auto_pay),
        accountId: liveCat?.account_id ?? null,
        external: Boolean(liveCat?.external),
        dueDate,
        dueIn,
        dueStatus,
        budget: toDollars(budget),
        spent: toDollars(spent),
        remaining: toDollars(budget - spent),
        pct: Math.round(pct * 10) / 10,
        status: statusFor(pct),
        // Everyday categories also carry their paycheck-sized slice: the
        // month's budget split across the month's paychecks.
        ...(row.kind === 'variable' ? (() => {
          const perBudget = Math.round(budget / period.count);
          const perSpent = periodSpent.get(row.category_id) ?? 0;
          const perPct = perBudget > 0 ? (perSpent / perBudget) * 100 : perSpent > 0 ? 101 : 0;
          return {
            periodBudget: toDollars(perBudget),
            periodSpent: toDollars(perSpent),
            periodRemaining: toDollars(perBudget - perSpent),
            periodPct: Math.round(perPct * 10) / 10,
            periodStatus: statusFor(perPct),
          };
        })() : {}),
        // A category retired mid-month keeps showing while it still holds
        // spending, so the dashboard total always matches History.
        archived: !liveIds.has(row.category_id),
        paid: row.kind === 'fixed' ? fullyPaid : undefined,
        paidAmount: paidRow ? toDollars(paidRow.paid_cents) : undefined,
        // Who ticked it off, so the other phone can see what was done.
        paidBy: paidRow ? paidRow.who : undefined,
        paidDate: paidRow ? paidRow.last_date : undefined,
      };
    });

    // Bills with a due date come first, earliest first, so the next thing to pay
    // is at the top of the checklist. Everything else keeps its configured order.
    categories.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'fixed' ? -1 : 1;
      if (a.kind !== 'fixed') return 0;
      // Whatever gets paid next comes first, whether it's pinned to a payday
      // or a calendar day; undated bills sink to the bottom.
      if (a.dueDate && b.dueDate) return a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0;
      if (a.dueDate) return -1;
      if (b.dueDate) return 1;
      return 0;
    });

    const incomeCents = q.monthIncome.get(month)?.income_cents ?? liveIncomeCents();
    const spentCents = categories.reduce((s, c) => s + Math.round(c.spent * 100), 0);

    // Actual money received this month, overall and per source.
    const incomeEntryRows = q.incomeEntriesForMonth.all(month);
    const receivedCents = incomeEntryRows.reduce((s, e) => s + e.amount_cents, 0);
    const receivedMap = new Map(q.receivedBySource.all(month).map((r) => [r.source_id, r]));

    const txRows = q.txForMonth.all(month);
    const transactions = txRows.map((t) => ({
      id: t.id,
      category_id: t.category_id,
      category: t.category,
      category_kind: t.category_kind,
      amount: toDollars(t.amount_cents),
      note: t.note,
      person: t.person,
      date: t.date,
      source: t.source,
      account_id: t.account_id,
    }));

    const transfers = db.prepare(`
      SELECT t.*, fa.name AS from_name, ta.name AS to_name
      FROM transfers t
      JOIN accounts fa ON fa.id = t.from_id
      JOIN accounts ta ON ta.id = t.to_id
      WHERE t.month = ? ORDER BY t.date DESC, t.id DESC
    `).all(month).map((t) => ({
      id: t.id,
      from_id: t.from_id,
      to_id: t.to_id,
      from: t.from_name,
      to: t.to_name,
      amount: toDollars(t.amount_cents),
      note: t.note,
      person: t.person,
      date: t.date,
    }));

    const fund = fundBalanceCents();
    const debts = q.debts.all().map((d) => ({
      id: d.id,
      name: d.name,
      balance: toDollars(d.balance_cents),
      target: toDollars(d.target_cents),
      label: d.label,
      settled: Boolean(d.settled),
      settledAmount: d.settled_cents == null ? null : toDollars(d.settled_cents),
      settledDate: d.settled_date,
      settledBy: d.settled_by,
      // How much of this target the settlement fund can cover right now.
      coverage: d.settled
        ? 100
        : d.target_cents > 0
          ? Math.min(100, Math.round((Math.max(0, fund.balance) / d.target_cents) * 1000) / 10)
          : 0,
    }));

    const months = q.months.all().map((r) => r.month);
    const cur = currentMonth();
    if (!months.includes(cur)) months.unshift(cur);

    // ---- weekly breakdown (Sunday weeks, clipped to the month) ----
    const monthStart = `${month}-01`;
    const monthEnd = lastDayOfMonth(month);
    const daysInMonth = Number(monthEnd.slice(8, 10));
    const variableBudgetCents = categories
      .filter((c) => c.kind === 'variable')
      .reduce((s, c) => s + Math.round(c.budget * 100), 0);
    // An even weekly pace for everyday (variable) spending. Bills are excluded
    // on purpose: the mortgage landing in week one is not "overspending".
    const weeklyAllowanceCents = Math.round((variableBudgetCents * 7) / daysInMonth);

    const weeks = [];
    let wkStart = weekStartOf(monthStart);
    let index = 0;
    while (wkStart <= monthEnd) {
      const wkEnd = addDays(wkStart, 6);
      const from = wkStart < monthStart ? monthStart : wkStart;
      const to = wkEnd > monthEnd ? monthEnd : wkEnd;
      const inWeek = (d) => d >= from && d <= to;

      const spentAll = txRows.filter((t) => inWeek(t.date)).reduce((s, t) => s + t.amount_cents, 0);
      const spentEveryday = txRows
        .filter((t) => inWeek(t.date) && t.category_kind === 'variable')
        .reduce((s, t) => s + t.amount_cents, 0);
      const incomeWk = incomeEntryRows.filter((e) => inWeek(e.date)).reduce((s, e) => s + e.amount_cents, 0);

      index += 1;
      weeks.push({
        n: index,
        from,
        to,
        spent: toDollars(spentAll),
        everyday: toDollars(spentEveryday),
        income: toDollars(incomeWk),
        isCurrent: month === cur && today() >= from && today() <= to,
      });
      wkStart = addDays(wkStart, 7);
    }

    // ---- savings ----
    const savingsRows = db.prepare(`SELECT * FROM savings_entries ORDER BY date DESC, id DESC`).all();
    const savingsBalance = savingsRows.reduce((s, e) => s + e.amount_cents, 0);
    const savedThisMonth = savingsRows
      .filter((e) => e.date.slice(0, 7) === cur)
      .reduce((s, e) => s + e.amount_cents, 0);
    const savingsTargetRow = db.prepare(`SELECT value FROM meta WHERE key = 'savings_target'`).get();
    const savingsTarget = savingsTargetRow ? Number(savingsTargetRow.value) : 0;

    // ---- last-month review: overspending alerts + leftover nudge ----
    let review = null;
    if (month === cur) {
      const prev = previousMonth();
      const prevTx = db.prepare(`SELECT COUNT(*) AS n FROM transactions WHERE month = ?`).get(prev).n;
      if (prevTx > 0) {
        // The month may never have been opened (e.g. its data arrived via a
        // statement import), so make sure its budget snapshot exists first.
        ensureMonth(prev);
        const prevSpent = new Map(q.spentByCategory.all(prev).map((r) => [r.category_id, r.spent]));
        const overs = q.monthRows.all(prev)
          .map((row) => ({
            name: row.name,
            budget: toDollars(row.budget_cents),
            spent: toDollars(prevSpent.get(row.category_id) ?? 0),
            over: toDollars((prevSpent.get(row.category_id) ?? 0) - row.budget_cents),
          }))
          .filter((x) => x.over > 0)
          .sort((a, b) => b.over - a.over);

        const prevSpentTotal = [...prevSpent.values()].reduce((s, n) => s + n, 0);
        const prevReceived = db.prepare(`SELECT COALESCE(SUM(amount_cents),0) AS n FROM income_entries WHERE month = ?`).get(prev).n;
        const prevIncome = q.monthIncome.get(prev)?.income_cents ?? 0;
        const basis = prevReceived > 0 ? prevReceived : prevIncome;
        review = {
          month: prev,
          overs: overs.slice(0, 6),
          overTotal: toDollars(overs.reduce((s, x) => s + Math.round(x.over * 100), 0)),
          leftover: toDollars(basis - prevSpentTotal),
          leftoverBasis: prevReceived > 0 ? 'received' : 'planned',
          // How many budget changes the tune-up would propose right now, so
          // the report can say "3 suggestions ready — review & accept".
          suggestionCount: computeSuggestions().suggestions.length,
        };
      }
    }

    const currentWeek = weeks.find((w) => w.isCurrent) || null;
    const week = currentWeek
      ? {
          from: currentWeek.from,
          to: currentWeek.to,
          everyday: currentWeek.everyday,
          spent: currentWeek.spent,
          income: currentWeek.income,
          allowance: toDollars(weeklyAllowanceCents),
          remaining: toDollars(weeklyAllowanceCents - Math.round(currentWeek.everyday * 100)),
          pct: weeklyAllowanceCents > 0
            ? Math.round((Math.round(currentWeek.everyday * 100) / weeklyAllowanceCents) * 1000) / 10
            : 0,
          status: statusFor(weeklyAllowanceCents > 0
            ? (Math.round(currentWeek.everyday * 100) / weeklyAllowanceCents) * 100
            : 0),
        }
      : null;

    return {
      person,
      month,
      app: APP_REV,
      today: today(),
      currentMonth: cur,
      timezone: TZ,
      readOnly: !isWritableMonth(month),
      // Last month stays open for a few days so a purchase made on the 31st
      // can still be entered on the 1st.
      grace: {
        days: graceDays(),
        open: inGraceWindow(),
        earliestDate: earliestWritableDate(),
        closesAfter: graceDays() > 0 ? `${cur}-${String(graceDays()).padStart(2, '0')}` : null,
      },
      version: lastChange.version,
      lastChange,
      months,
      people: PEOPLE,
      totals: {
        income: toDollars(incomeCents),
        received: toDollars(receivedCents),
        spent: toDollars(spentCents),
        remaining: toDollars(incomeCents - spentCents),
        budgeted: toDollars(categories.reduce((s, c) => s + Math.round(c.budget * 100), 0)),
      },
      bank: bankState(),
      transfers,
      paydays: monthPaydayRows,
      // Bills that begin this month — the usual reason a month is suddenly
      // tighter than the one before it.
      newThisMonth: live
        .filter((c) => c.starts_month === month)
        .map((c) => ({ name: c.name, budget: toDollars(monthlyBudgetCents(c, month)) })),
      payPeriod: {
        start: period.start,
        last: period.last,
        index: period.index,
        count: period.count,
        // Whether this month's spending is being tracked per paycheck at all.
        perPaycheck: period.count > 1,
      },
      categories,
      upcoming,
      weeks,
      week,
      review,
      savings: {
        balance: toDollars(savingsBalance),
        thisMonth: toDollars(savedThisMonth),
        target: toDollars(savingsTarget),
        goals: db.prepare(`SELECT * FROM savings_goals ORDER BY sort_order, id`).all().map((g) => {
          const saved = savingsRows
            .filter((e) => e.goal_id === g.id)
            .reduce((s, e) => s + e.amount_cents, 0);
          return {
            id: g.id,
            name: g.name,
            target: toDollars(g.target_cents),
            saved: toDollars(saved),
            pct: g.target_cents > 0 ? Math.min(100, Math.round((saved / g.target_cents) * 1000) / 10) : 0,
          };
        }),
        entries: savingsRows.slice(0, 12).map((e) => ({
          id: e.id,
          amount: toDollars(e.amount_cents),
          note: e.note,
          person: e.person,
          date: e.date,
          goal_id: e.goal_id,
        })),
      },
      transactions,
      debts,
      fund: {
        balance: toDollars(fund.balance),
        contributed: toDollars(fund.contributed),
        deposited: toDollars(fund.deposited),
        spent: toDollars(fund.spent),
        deposits: q.deposits.all().map((d) => ({
          id: d.id,
          amount: toDollars(d.amount_cents),
          note: d.note,
          person: d.person,
          date: d.date,
        })),
      },
      income: {
        total: toDollars(incomeCents),
        received: toDollars(receivedCents),
        sources: q.incomeSources.all().map((s) => {
          const got = receivedMap.get(s.id);
          const payday = s.next_date ? nextOccurrence(s.next_date, s.cadence || 'biweekly', today()) : null;
          return {
            id: s.id,
            name: s.name,
            person: s.person,
            amount: toDollars(s.amount_cents),
            per_month: s.per_month,
            monthly: toDollars(s.amount_cents * s.per_month),
            received: got ? toDollars(got.total) : 0,
            checks: got ? got.n : 0,
            cadence: s.cadence || null,
            nextPayday: payday,
            payInDays: payday ? daysUntil(payday) : null,
          };
        }),
        entries: incomeEntryRows.map((e) => ({
          id: e.id,
          source_id: e.source_id,
          label: e.label,
          amount: toDollars(e.amount_cents),
          note: e.note,
          person: e.person,
          date: e.date,
          account_id: e.account_id,
        })),
      },
    };
  }

  // ---------------------------------------------------------------- validation

  function requireMonthWritable(dateStr) {
    const month = dateStr.slice(0, 7);
    if (isWritableMonth(month)) return;
    if (month > currentMonth()) throw new HttpError(409, 'That month has not started yet.');
    throw new HttpError(409, 'That month is closed — it is read-only now.');
  }

  function readAmount(value, { allowNegative = false } = {}) {
    const cents = toCents(value);
    if (cents === null) throw bad('Amount must be a number.');
    if (!allowNegative && cents <= 0) throw bad('Amount must be greater than zero.');
    if (Math.abs(cents) > 100_000_000) throw bad('Amount is too large.');
    return cents;
  }

  function readDate(value) {
    if (value === undefined || value === null || value === '') return today();
    if (!isValidDate(value)) throw bad('Date must be YYYY-MM-DD.');
    return value;
  }

  function readPerson(value, fallback) {
    if (value === undefined || value === null || value === '') return fallback;
    if (!PEOPLE.includes(value)) throw bad('Unknown person.');
    return value;
  }

  function readNote(value) {
    if (value === undefined || value === null) return '';
    return String(value).slice(0, 200);
  }

  function readName(value) {
    const name = String(value ?? '').trim();
    if (!name) throw bad('Name is required.');
    if (name.length > 60) throw bad('Name is too long.');
    return name;
  }

  // Offline Quick Add sends a phone-generated id with each entry so a retry
  // of the same queued entry can never insert twice.
  function readClientId(value) {
    if (value === undefined || value === null || value === '') return null;
    const id = String(value).trim().slice(0, 64);
    return id || null;
  }

  // ---------------------------------------------------------------- auth

  router.post('/login', (req, res) => {
    const { person, pin } = req.body || {};
    if (!PEOPLE.includes(person)) {
      return res.status(400).json({ error: 'Pick Chris or Miriam.' });
    }
    if (!pinMatches(pin)) {
      return res.status(401).json({ error: 'That PIN is not right.' });
    }
    res.json({ token: makeToken(person), person });
  });

  function auth(req, res, next) {
    const header = req.get('authorization') || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : req.query.token;
    const person = verifyToken(token);
    if (!person) return res.status(401).json({ error: 'Sign in again.' });
    req.person = person;
    next();
  }

  // ---------------------------------------------------------------- state + realtime

  router.get('/state', auth, (req, res) => {
    const month = req.query.month ? String(req.query.month) : currentMonth();
    if (!isValidMonth(month)) throw bad('Month must be YYYY-MM.');
    res.json(buildState(month, req.person));
  });

  router.get('/version', auth, (req, res) => {
    res.json(Object.assign({ app: APP_REV }, lastChange));
  });

  router.get('/events', auth, (req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write(`retry: 3000\n`);
    res.write(`event: change\ndata: ${JSON.stringify(lastChange)}\n\n`);
    clients.add(res);

    const ping = setInterval(() => {
      try {
        res.write(`: ping\n\n`);
      } catch {
        /* cleaned up by the close handler */
      }
    }, 25_000);

    req.on('close', () => {
      clearInterval(ping);
      clients.delete(res);
      res.end();
    });
  });

  // ---------------------------------------------------------------- transactions

  /** Categories you can still spend against (archived ones are history only). */
  function activeCategory(id) {
    const category = q.categoryById.get(Number(id));
    if (!category || category.archived) throw notFound('Category not found.');
    return category;
  }

  /** A scheduled bill takes no money before the month it begins. */
  function requireStarted(category, month) {
    if (category.starts_month && category.starts_month > month) {
      throw bad(`${category.name} does not start until ${category.starts_month}.`);
    }
  }

  function readBillCadence(value) {
    if (value === undefined) return undefined;
    if (value === null || value === '' || value === 'monthly') return null;
    if (value !== 'payday') throw bad('Bill cadence must be monthly or payday.');
    return 'payday';
  }

  function readDueDay(value) {
    if (value === undefined) return undefined;
    if (value === null || value === '') return null;
    const day = Math.floor(Number(value));
    if (!Number.isFinite(day) || day < 1 || day > 31) throw bad('Due day must be between 1 and 31.');
    return day;
  }

  function readStartsMonth(value) {
    if (value === undefined) return undefined;
    if (value === null || value === '') return null;
    if (!isValidMonth(value)) throw bad('Start month must be YYYY-MM.');
    return value <= currentMonth() ? null : value;
  }

  router.post('/transactions', auth, (req, res) => {
    const body = req.body || {};
    const clientId = readClientId(body.client_id);
    if (clientId) {
      const existing = db.prepare(`SELECT id, month FROM transactions WHERE client_id = ?`).get(clientId);
      if (existing) {
        // The queued entry already made it through on an earlier retry.
        return res.status(200).json({ id: existing.id, deduped: true, state: buildState(existing.month, req.person) });
      }
    }
    const category = activeCategory(body.category_id);
    const amount = readAmount(body.amount);
    const date = readDate(body.date);
    requireMonthWritable(date);
    requireStarted(category, date.slice(0, 7));
    const person = readPerson(body.person, req.person);
    const note = readNote(body.note);
    const accountId = readAccount(body.account_id);
    const now = new Date().toISOString();

    const info = db
      .prepare(`
        INSERT INTO transactions (category_id, amount_cents, note, person, date, month, source, created_at, updated_at, client_id, account_id)
        VALUES (?, ?, ?, ?, ?, ?, 'manual', ?, ?, ?, ?)
      `)
      .run(category.id, amount, note, person, date, date.slice(0, 7), now, now, clientId, accountId);

    broadcast('transaction:add', req.person);
    res.status(201).json({ id: info.lastInsertRowid, state: buildState(date.slice(0, 7), req.person) });
  });

  router.put('/transactions/:id', auth, (req, res) => {
    const existing = q.txById.get(Number(req.params.id));
    if (!existing) throw notFound('Transaction not found.');
    // Imported history stays correctable in closed months (recategorizing a
    // mislabeled merchant); hand-entered history keeps the closed-month rule.
    const isImport = existing.source === 'import';
    if (!isImport) requireMonthWritable(existing.date);

    const body = req.body || {};
    const category = body.category_id === undefined
      ? q.categoryById.get(existing.category_id)
      : activeCategory(body.category_id);
    if (!category) throw notFound('Category not found.');
    const amount = body.amount === undefined ? existing.amount_cents : readAmount(body.amount);
    const date = body.date === undefined ? existing.date : readDate(body.date);
    if (!isImport || date !== existing.date) requireMonthWritable(date);
    requireStarted(category, date.slice(0, 7));
    const person = readPerson(body.person, existing.person);
    const note = body.note === undefined ? existing.note : readNote(body.note);
    const accountId = body.account_id === undefined ? existing.account_id : readAccount(body.account_id);

    db.prepare(`
      UPDATE transactions
      SET category_id = ?, amount_cents = ?, note = ?, person = ?, date = ?, month = ?, updated_at = ?, account_id = ?
      WHERE id = ?
    `).run(category.id, amount, note, person, date, date.slice(0, 7), new Date().toISOString(), accountId, existing.id);

    // Recategorizing an imported row is a correction worth remembering: the
    // next statement files that merchant where the family actually put it.
    if (isImport && category.id !== existing.category_id) {
      const key = merchantKey(existing.note);
      if (key) upsertRule.run(key, category.id, new Date().toISOString());
    }

    broadcast('transaction:edit', req.person);
    res.json({ ok: true, state: buildState(date.slice(0, 7), req.person) });
  });

  router.delete('/transactions/:id', auth, (req, res) => {
    const existing = q.txById.get(Number(req.params.id));
    if (!existing) throw notFound('Transaction not found.');
    // Imported rows may be removed from any month — a bad import must always
    // be reversible. Hand-entered history keeps the closed-month rule.
    if (existing.source !== 'import') requireMonthWritable(existing.date);
    db.prepare(`DELETE FROM transactions WHERE id = ?`).run(existing.id);
    broadcast('transaction:delete', req.person);
    res.json({ ok: true, state: buildState(existing.month, req.person) });
  });

  // ---------------------------------------------------------------- bill checklist

  router.post('/bills/:categoryId/pay', auth, (req, res) => {
    const category = activeCategory(req.params.categoryId);
    if (category.kind !== 'fixed') throw bad('Only fixed bills can be checked off.');

    // Defaults to this month, but last month's checklist stays tappable
    // during the grace window.
    const month = req.body?.month === undefined ? currentMonth() : String(req.body.month);
    if (!isValidMonth(month)) throw bad('Month must be YYYY-MM.');
    requireMonthWritable(`${month}-01`);
    requireStarted(category, month);
    ensureMonth(month);

    const paid = req.body?.paid !== false;
    // A bill paid against last month is dated in that month, not today.
    const date = req.body?.date === undefined
      ? (month === currentMonth() ? today() : lastDayOfMonth(month))
      : readDate(req.body.date);
    if (date.slice(0, 7) !== month) throw bad('That date is not in the month being paid.');
    requireMonthWritable(date);

    const isPayday = category.cadence === 'payday';
    const now = new Date().toISOString();

    if (isPayday) {
      // Per-payday bills accumulate one payment per tap, up to the month's
      // payday count; untapping removes the most recent payment.
      const expected = paydayCount(month);
      const existing = db.prepare(`
        SELECT id FROM transactions WHERE month = ? AND category_id = ? AND source = 'billpay' ORDER BY id DESC
      `).all(month, category.id);
      if (paid) {
        if (existing.length >= expected) throw bad('Every payday payment is already recorded this month.');
        let amount;
        if (req.body?.amount !== undefined) {
          amount = readAmount(req.body.amount);
        } else if (category.percent_income) {
          // The tithe: a percent of what actually came in, minus what's paid.
          const received = db
            .prepare(`SELECT COALESCE(SUM(amount_cents), 0) AS n FROM income_entries WHERE month = ?`)
            .get(month).n;
          const paidSoFar = db
            .prepare(`SELECT COALESCE(SUM(amount_cents), 0) AS n FROM transactions WHERE month = ? AND category_id = ? AND source = 'billpay'`)
            .get(month, category.id).n;
          amount = Math.max(0, Math.round((category.percent_income / 100) * received) - paidSoFar);
          if (amount <= 0) {
            throw bad(received === 0
              ? 'Log the paychecks first — the tithe is ' + category.percent_income + '% of what actually comes in.'
              : 'The tithe is fully paid on everything that has come in so far.');
          }
        } else {
          amount = category.budget_cents;
        }
        if (amount <= 0) throw bad('Set a per-payday amount for this bill first.');
        db.prepare(`
          INSERT INTO transactions (category_id, amount_cents, note, person, date, month, source, created_at, updated_at, account_id)
          VALUES (?, ?, 'Paid', ?, ?, ?, 'billpay', ?, ?, ?)
        `).run(category.id, amount, req.person, date, month, now, now,
          req.body?.account_id === undefined ? accountForBill(category) : readAccount(req.body.account_id));
      } else if (existing.length) {
        db.prepare(`DELETE FROM transactions WHERE id = ?`).run(existing[0].id);
      }
    } else if (paid) {
      const snapshot = db
        .prepare(`SELECT budget_cents FROM month_budgets WHERE month = ? AND category_id = ?`)
        .get(month, category.id);
      const budgetC = snapshot?.budget_cents ?? category.budget_cents;
      // Spending already logged by hand against this bill counts toward it —
      // paying tops up the remainder instead of double-charging.
      const handLogged = db
        .prepare(`SELECT COALESCE(SUM(amount_cents), 0) AS n FROM transactions WHERE month = ? AND category_id = ? AND source != 'billpay'`)
        .get(month, category.id).n;
      const amount = req.body?.amount === undefined
        ? budgetC - handLogged
        : readAmount(req.body.amount);
      if (amount <= 0) {
        throw bad(handLogged > 0
          ? 'What was logged this month already covers this bill.'
          : 'Set a budget for this bill before marking it paid.');
      }
      db.transaction(() => {
        db.prepare(`DELETE FROM transactions WHERE month = ? AND category_id = ? AND source = 'billpay'`)
          .run(month, category.id);
        db.prepare(`
          INSERT INTO transactions (category_id, amount_cents, note, person, date, month, source, created_at, updated_at, account_id)
          VALUES (?, ?, 'Paid', ?, ?, ?, 'billpay', ?, ?, ?)
        `).run(category.id, amount, req.person, date, month, now, now,
          req.body?.account_id === undefined ? accountForBill(category) : readAccount(req.body.account_id));
      })();
    } else {
      db.prepare(`DELETE FROM transactions WHERE month = ? AND category_id = ? AND source = 'billpay'`)
        .run(month, category.id);
    }

    broadcast(paid ? 'bill:paid' : 'bill:unpaid', req.person);
    res.json({ ok: true, state: buildState(month, req.person) });
  });

  // ---------------------------------------------------------------- categories + income

  router.post('/categories', auth, (req, res) => {
    const body = req.body || {};
    const name = readName(body.name);
    const kind = body.kind === 'fixed' ? 'fixed' : 'variable';
    const budget = readAmount(body.budget ?? 0, { allowNegative: true });
    if (budget < 0) throw bad('Budget cannot be negative.');

    const startsMonth = readStartsMonth(body.starts_month) ?? null;
    const dueDay = readDueDay(body.due_day) ?? null;
    const newCadence = readBillCadence(body.cadence) ?? null;

    const clash = db.prepare(`SELECT id, archived FROM categories WHERE name = ?`).get(name);
    if (clash && !clash.archived) throw bad('A category with that name already exists.');

    let id;
    if (clash) {
      db.prepare(`
        UPDATE categories SET archived = 0, kind = ?, budget_cents = ?, starts_month = ?, due_day = ?, cadence = ?
        WHERE id = ?
      `).run(kind, budget, startsMonth, dueDay, newCadence, clash.id);
      id = clash.id;
    } else {
      const next = db
        .prepare(`SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM categories WHERE kind = ?`)
        .get(kind).n;
      id = db
        .prepare(`
          INSERT INTO categories (name, kind, budget_cents, sort_order, starts_month, due_day, cadence)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `)
        .run(name, kind, budget, next, startsMonth, dueDay, newCadence).lastInsertRowid;
    }

    broadcast('category:add', req.person);
    res.status(201).json({ id, state: buildState(currentMonth(), req.person) });
  });

  router.put('/categories/:id', auth, (req, res) => {
    const category = q.categoryById.get(Number(req.params.id));
    if (!category) throw notFound('Category not found.');
    const body = req.body || {};
    const name = body.name === undefined ? category.name : readName(body.name);
    const budget = body.budget === undefined
      ? category.budget_cents
      : readAmount(body.budget, { allowNegative: true });
    if (budget < 0) throw bad('Budget cannot be negative.');
    const kind = body.kind === undefined ? category.kind : body.kind === 'fixed' ? 'fixed' : 'variable';

    const startsRaw = readStartsMonth(body.starts_month);
    const startsMonth = startsRaw === undefined ? category.starts_month : startsRaw;
    const dueRaw = readDueDay(body.due_day);
    let dueDay = dueRaw === undefined ? category.due_day : dueRaw;
    const cadenceRaw = readBillCadence(body.cadence);
    const cadence = cadenceRaw === undefined ? category.cadence : cadenceRaw;
    // A bill is scheduled either by paycheck or by calendar day, never both.
    let duePayday = category.due_payday;
    if (body.due_payday !== undefined) {
      if (body.due_payday === null || body.due_payday === '') duePayday = null;
      else {
        const p3 = Number(body.due_payday);
        if (p3 !== 0 && p3 !== 1) throw bad('Pick which paycheck pays this bill.');
        duePayday = p3;
      }
      if (duePayday !== null) dueDay = null;
    } else if (dueRaw !== undefined && dueRaw !== null) {
      duePayday = null;
    }
    let percent = category.percent_income;
    if (body.percent_income !== undefined) {
      if (body.percent_income === null || body.percent_income === '') percent = null;
      else {
        const p2 = Math.round(Number(body.percent_income));
        if (!Number.isFinite(p2) || p2 < 1 || p2 > 100) throw bad('Percent must be between 1 and 100.');
        percent = p2;
      }
    }

    const autoPay = body.auto_pay === undefined ? category.auto_pay : (body.auto_pay ? 1 : 0);
    const external = body.external === undefined ? category.external : (body.external ? 1 : 0);
    const billAccount = body.account_id === undefined
      ? category.account_id
      : (body.account_id === null || body.account_id === '' ? null : readAccount(body.account_id));

    const clash = db.prepare(`SELECT id FROM categories WHERE name = ? AND id != ?`).get(name, category.id);
    if (clash) throw bad('A category with that name already exists.');

    db.prepare(`
      UPDATE categories SET name = ?, budget_cents = ?, kind = ?, starts_month = ?, due_day = ?, cadence = ?, percent_income = ?, due_payday = ?, auto_pay = ?, account_id = ?, external = ?
      WHERE id = ?
    `).run(name, budget, kind, startsMonth, dueDay, cadence, percent, duePayday, autoPay, billAccount, external, category.id);

    broadcast('category:edit', req.person);
    res.json({ ok: true, state: buildState(currentMonth(), req.person) });
  });

  router.delete('/categories/:id', auth, (req, res) => {
    const category = q.categoryById.get(Number(req.params.id));
    if (!category) throw notFound('Category not found.');
    // Archive rather than delete so historical transactions survive.
    db.prepare(`UPDATE categories SET archived = 1 WHERE id = ?`).run(category.id);
    broadcast('category:remove', req.person);
    res.json({ ok: true, state: buildState(currentMonth(), req.person) });
  });

  // ---- actual paychecks / money received -------------------------------

  function readIncomeSource(value) {
    if (value === undefined || value === null || value === '') return null;
    const source = db.prepare(`SELECT * FROM income_sources WHERE id = ?`).get(Number(value));
    if (!source) throw notFound('Income source not found.');
    return source;
  }

  router.post('/income/entries', auth, (req, res) => {
    const body = req.body || {};
    const clientId = readClientId(body.client_id);
    if (clientId) {
      const existing = db.prepare(`SELECT id, month FROM income_entries WHERE client_id = ?`).get(clientId);
      if (existing) {
        return res.status(200).json({ id: existing.id, deduped: true, state: buildState(existing.month, req.person) });
      }
    }
    const amount = readAmount(body.amount);
    const date = readDate(body.date);
    requireMonthWritable(date);
    const person = readPerson(body.person, req.person);
    const note = readNote(body.note);
    const source = readIncomeSource(body.source_id);
    const rawLabel = String(body.label ?? '').trim();
    const label = (rawLabel || (source ? source.name : 'Income')).slice(0, 60);
    const accountId = readAccount(body.account_id);
    const now = new Date().toISOString();

    const id = db.prepare(`
      INSERT INTO income_entries (source_id, label, amount_cents, note, person, date, month, created_at, updated_at, client_id, account_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(source ? source.id : null, label, amount, note, person, date, date.slice(0, 7), now, now, clientId, accountId).lastInsertRowid;

    broadcast('income:received', req.person);
    res.status(201).json({ id, state: buildState(date.slice(0, 7), req.person) });
  });

  router.put('/income/entries/:id', auth, (req, res) => {
    const existing = q.incomeEntryById.get(Number(req.params.id));
    if (!existing) throw notFound('Income entry not found.');
    requireMonthWritable(existing.date);

    const body = req.body || {};
    const amount = body.amount === undefined ? existing.amount_cents : readAmount(body.amount);
    const date = body.date === undefined ? existing.date : readDate(body.date);
    requireMonthWritable(date);
    const person = readPerson(body.person, existing.person);
    const note = body.note === undefined ? existing.note : readNote(body.note);
    const source = body.source_id === undefined ? undefined : readIncomeSource(body.source_id);
    const sourceId = source === undefined ? existing.source_id : source ? source.id : null;
    const rawLabel = body.label === undefined ? existing.label : String(body.label ?? '').trim();
    const label = (rawLabel || (source ? source.name : existing.label) || 'Income').slice(0, 60);

    db.prepare(`
      UPDATE income_entries
      SET source_id = ?, label = ?, amount_cents = ?, note = ?, person = ?, date = ?, month = ?, updated_at = ?
      WHERE id = ?
    `).run(sourceId, label, amount, note, person, date, date.slice(0, 7), new Date().toISOString(), existing.id);

    broadcast('income:edited', req.person);
    res.json({ ok: true, state: buildState(date.slice(0, 7), req.person) });
  });

  router.delete('/income/entries/:id', auth, (req, res) => {
    const existing = q.incomeEntryById.get(Number(req.params.id));
    if (!existing) throw notFound('Income entry not found.');
    requireMonthWritable(existing.date);
    db.prepare(`DELETE FROM income_entries WHERE id = ?`).run(existing.id);
    broadcast('income:entry-removed', req.person);
    res.json({ ok: true, state: buildState(existing.month, req.person) });
  });

  function readCadence(value) {
    if (value === undefined) return undefined;
    if (value === null || value === '') return null;
    if (!['weekly', 'biweekly', 'monthly'].includes(value)) throw bad('Cadence must be weekly, biweekly or monthly.');
    return value;
  }

  function readPaydayDate(value) {
    if (value === undefined) return undefined;
    if (value === null || value === '') return null;
    if (!isValidDate(value)) throw bad('Payday must be YYYY-MM-DD.');
    return value;
  }

  router.post('/income', auth, (req, res) => {
    const body = req.body || {};
    const name = readName(body.name);
    const amount = readAmount(body.amount ?? 0, { allowNegative: true });
    if (amount < 0) throw bad('Income cannot be negative.');
    const perMonth = Math.max(1, Math.min(12, Math.round(Number(body.per_month ?? 1)) || 1));
    const person = body.person && PEOPLE.includes(body.person) ? body.person : '';
    const nextDate = readPaydayDate(body.next_date) ?? null;
    const cadence = readCadence(body.cadence) ?? (nextDate ? 'biweekly' : null);
    const next = db.prepare(`SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM income_sources`).get().n;
    const id = db
      .prepare(`INSERT INTO income_sources (name, person, amount_cents, per_month, sort_order, next_date, cadence) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(name, person, amount, perMonth, next, nextDate, cadence).lastInsertRowid;
    broadcast('income:add', req.person);
    res.status(201).json({ id, state: buildState(currentMonth(), req.person) });
  });

  router.put('/income/:id', auth, (req, res) => {
    const src = db.prepare(`SELECT * FROM income_sources WHERE id = ?`).get(Number(req.params.id));
    if (!src) throw notFound('Income source not found.');
    const body = req.body || {};
    const name = body.name === undefined ? src.name : readName(body.name);
    const amount = body.amount === undefined ? src.amount_cents : readAmount(body.amount, { allowNegative: true });
    if (amount < 0) throw bad('Income cannot be negative.');
    const perMonth = body.per_month === undefined
      ? src.per_month
      : Math.max(1, Math.min(12, Math.round(Number(body.per_month)) || 1));
    const person = body.person === undefined
      ? src.person
      : PEOPLE.includes(body.person) ? body.person : '';
    const nextDateRaw = readPaydayDate(body.next_date);
    const nextDate = nextDateRaw === undefined ? src.next_date : nextDateRaw;
    const cadenceRaw = readCadence(body.cadence);
    const cadence = cadenceRaw === undefined ? src.cadence : cadenceRaw;
    db.prepare(`UPDATE income_sources SET name = ?, person = ?, amount_cents = ?, per_month = ?, next_date = ?, cadence = ? WHERE id = ?`)
      .run(name, person, amount, perMonth, nextDate, cadence, src.id);
    broadcast('income:edit', req.person);
    res.json({ ok: true, state: buildState(currentMonth(), req.person) });
  });

  router.delete('/income/:id', auth, (req, res) => {
    const src = db.prepare(`SELECT * FROM income_sources WHERE id = ?`).get(Number(req.params.id));
    if (!src) throw notFound('Income source not found.');
    db.prepare(`DELETE FROM income_sources WHERE id = ?`).run(src.id);
    broadcast('income:remove', req.person);
    res.json({ ok: true, state: buildState(currentMonth(), req.person) });
  });

  // ---------------------------------------------------------------- debts + settlement fund

  router.put('/debts/:id', auth, (req, res) => {
    const debt = q.debtById.get(Number(req.params.id));
    if (!debt) throw notFound('Debt not found.');
    const body = req.body || {};
    const name = body.name === undefined ? debt.name : readName(body.name);
    const balance = body.balance === undefined ? debt.balance_cents : readAmount(body.balance, { allowNegative: true });
    const target = body.target === undefined ? debt.target_cents : readAmount(body.target, { allowNegative: true });
    if (balance < 0 || target < 0) throw bad('Amounts cannot be negative.');
    const label = body.label === undefined ? debt.label : String(body.label).slice(0, 80);
    db.prepare(`UPDATE debts SET name = ?, balance_cents = ?, target_cents = ?, label = ? WHERE id = ?`)
      .run(name, balance, target, label, debt.id);
    broadcast('debt:edit', req.person);
    res.json({ ok: true, state: buildState(currentMonth(), req.person) });
  });

  router.post('/debts/:id/settle', auth, (req, res) => {
    const debt = q.debtById.get(Number(req.params.id));
    if (!debt) throw notFound('Debt not found.');
    const body = req.body || {};
    const amount = body.amount === undefined ? debt.target_cents : readAmount(body.amount);
    const date = readDate(body.date);
    db.prepare(`UPDATE debts SET settled = 1, settled_cents = ?, settled_date = ?, settled_by = ? WHERE id = ?`)
      .run(amount, date, req.person, debt.id);
    broadcast('debt:settled', req.person);
    res.json({ ok: true, state: buildState(currentMonth(), req.person) });
  });

  router.post('/debts/:id/unsettle', auth, (req, res) => {
    const debt = q.debtById.get(Number(req.params.id));
    if (!debt) throw notFound('Debt not found.');
    db.prepare(`UPDATE debts SET settled = 0, settled_cents = NULL, settled_date = NULL, settled_by = NULL WHERE id = ?`)
      .run(debt.id);
    broadcast('debt:reopened', req.person);
    res.json({ ok: true, state: buildState(currentMonth(), req.person) });
  });

  router.post('/fund/deposits', auth, (req, res) => {
    const body = req.body || {};
    const amount = readAmount(body.amount);
    const date = readDate(body.date);
    const person = readPerson(body.person, req.person);
    const note = readNote(body.note);
    const id = db
      .prepare(`INSERT INTO fund_deposits (amount_cents, note, person, date, created_at) VALUES (?, ?, ?, ?, ?)`)
      .run(amount, note, person, date, new Date().toISOString()).lastInsertRowid;
    broadcast('fund:deposit', req.person);
    res.status(201).json({ id, state: buildState(currentMonth(), req.person) });
  });

  router.delete('/fund/deposits/:id', auth, (req, res) => {
    const dep = db.prepare(`SELECT * FROM fund_deposits WHERE id = ?`).get(Number(req.params.id));
    if (!dep) throw notFound('Deposit not found.');
    db.prepare(`DELETE FROM fund_deposits WHERE id = ?`).run(dep.id);
    broadcast('fund:deposit-removed', req.person);
    res.json({ ok: true, state: buildState(currentMonth(), req.person) });
  });

  // ---------------------------------------------------------------- push notifications

  router.get('/push/vapid-key', auth, (req, res) => {
    // Generated on first use and kept in the database — nothing to configure.
    const { ensureVapid } = require('./push');
    res.json({ key: ensureVapid(db) });
  });

  router.post('/push/subscribe', auth, (req, res) => {
    const sub = req.body?.subscription;
    if (!sub || typeof sub.endpoint !== 'string' || !sub.endpoint.startsWith('https://') || !sub.keys) {
      throw bad('That does not look like a push subscription.');
    }
    db.prepare(`
      INSERT INTO push_subscriptions (endpoint, keys_json, person, created_at) VALUES (?, ?, ?, ?)
      ON CONFLICT (endpoint) DO UPDATE SET keys_json = excluded.keys_json, person = excluded.person
    `).run(sub.endpoint.slice(0, 1000), JSON.stringify(sub.keys), req.person, new Date().toISOString());
    res.status(201).json({ ok: true });
  });

  router.post('/push/unsubscribe', auth, (req, res) => {
    const endpoint = String(req.body?.endpoint || '');
    db.prepare(`DELETE FROM push_subscriptions WHERE endpoint = ?`).run(endpoint);
    res.json({ ok: true });
  });

  router.post('/push/test', auth, async (req, res) => {
    const { sendToAll } = require('./push');
    const sent = await sendToAll(db, {
      title: 'Lattimer Family Budget',
      body: `Notifications are working on this account. — ${req.person}`,
      tag: 'test',
    });
    res.json({ ok: true, sent });
  });

  // ---------------------------------------------------------------- restore (the undo button)

  router.post('/transactions/restore', auth, (req, res) => {
    const body = req.body || {};
    const category = activeCategory(body.category_id);
    const amount = readAmount(body.amount);
    const date = readDate(body.date);
    if (date > today()) throw bad('Cannot restore into the future.');
    const source = ['manual', 'billpay', 'import'].includes(body.source) ? body.source : 'manual';
    const now = new Date().toISOString();
    const id = db.prepare(`
      INSERT INTO transactions (category_id, amount_cents, note, person, date, month, source, created_at, updated_at, import_hash)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      category.id, amount, readNote(body.note), readPerson(body.person, req.person),
      date, date.slice(0, 7), source, now, now,
      typeof body.import_hash === 'string' ? body.import_hash.slice(0, 64) : null
    ).lastInsertRowid;
    broadcast('transaction:restored', req.person);
    res.status(201).json({ id, state: buildState(date.slice(0, 7), req.person) });
  });

  router.post('/income/entries/restore', auth, (req, res) => {
    const body = req.body || {};
    const amount = readAmount(body.amount);
    const date = readDate(body.date);
    if (date > today()) throw bad('Cannot restore into the future.');
    const source = readIncomeSource(body.source_id);
    const now = new Date().toISOString();
    const id = db.prepare(`
      INSERT INTO income_entries (source_id, label, amount_cents, note, person, date, month, created_at, updated_at, import_hash)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      source ? source.id : null,
      String(body.label ?? 'Income').trim().slice(0, 60) || 'Income',
      amount, readNote(body.note), readPerson(body.person, req.person),
      date, date.slice(0, 7), now, now,
      typeof body.import_hash === 'string' ? body.import_hash.slice(0, 64) : null
    ).lastInsertRowid;
    broadcast('income:restored', req.person);
    res.status(201).json({ id, state: buildState(date.slice(0, 7), req.person) });
  });

  // ---------------------------------------------------------------- savings goals

  router.post('/savings/goals', auth, (req, res) => {
    const name = readName(req.body?.name);
    const target = readAmount(req.body?.target ?? 0, { allowNegative: true });
    if (target < 0) throw bad('Target cannot be negative.');
    const next = db.prepare(`SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM savings_goals`).get().n;
    const id = db.prepare(`INSERT INTO savings_goals (name, target_cents, sort_order, created_at) VALUES (?, ?, ?, ?)`)
      .run(name, target, next, new Date().toISOString()).lastInsertRowid;
    broadcast('savings:goal-added', req.person);
    res.status(201).json({ id, state: buildState(currentMonth(), req.person) });
  });

  router.put('/savings/goals/:id', auth, (req, res) => {
    const goal = db.prepare(`SELECT * FROM savings_goals WHERE id = ?`).get(Number(req.params.id));
    if (!goal) throw notFound('Goal not found.');
    const body = req.body || {};
    const name = body.name === undefined ? goal.name : readName(body.name);
    const target = body.target === undefined ? goal.target_cents : readAmount(body.target, { allowNegative: true });
    if (target < 0) throw bad('Target cannot be negative.');
    db.prepare(`UPDATE savings_goals SET name = ?, target_cents = ? WHERE id = ?`).run(name, target, goal.id);
    broadcast('savings:goal-edited', req.person);
    res.json({ ok: true, state: buildState(currentMonth(), req.person) });
  });

  router.delete('/savings/goals/:id', auth, (req, res) => {
    const goal = db.prepare(`SELECT * FROM savings_goals WHERE id = ?`).get(Number(req.params.id));
    if (!goal) throw notFound('Goal not found.');
    // Entries keep their money; they just lose the label.
    db.prepare(`DELETE FROM savings_goals WHERE id = ?`).run(goal.id);
    broadcast('savings:goal-removed', req.person);
    res.json({ ok: true, state: buildState(currentMonth(), req.person) });
  });

  // ---------------------------------------------------------------- savings

  router.post('/savings/entries', auth, (req, res) => {
    const body = req.body || {};
    const amount = readAmount(body.amount);
    const signed = body.direction === 'out' ? -amount : amount;
    const date = readDate(body.date);
    if (date > today()) throw bad('Savings entries cannot be in the future.');
    const person = readPerson(body.person, req.person);
    const note = readNote(body.note);
    let goalId = null;
    if (body.goal_id !== undefined && body.goal_id !== null && body.goal_id !== '') {
      const goal = db.prepare(`SELECT id FROM savings_goals WHERE id = ?`).get(Number(body.goal_id));
      if (!goal) throw notFound('Goal not found.');
      goalId = goal.id;
    }
    const id = db.prepare(`
      INSERT INTO savings_entries (amount_cents, note, person, date, created_at, goal_id) VALUES (?, ?, ?, ?, ?, ?)
    `).run(signed, note, person, date, new Date().toISOString(), goalId).lastInsertRowid;
    broadcast(signed >= 0 ? 'savings:added' : 'savings:withdrawn', req.person);
    res.status(201).json({ id, state: buildState(currentMonth(), req.person) });
  });

  router.delete('/savings/entries/:id', auth, (req, res) => {
    const existing = db.prepare(`SELECT * FROM savings_entries WHERE id = ?`).get(Number(req.params.id));
    if (!existing) throw notFound('Savings entry not found.');
    db.prepare(`DELETE FROM savings_entries WHERE id = ?`).run(existing.id);
    broadcast('savings:removed', req.person);
    res.json({ ok: true, state: buildState(currentMonth(), req.person) });
  });

  router.put('/savings/target', auth, (req, res) => {
    const cents = readAmount(req.body?.amount ?? 0, { allowNegative: true });
    if (cents < 0) throw bad('The target cannot be negative.');
    db.prepare(`INSERT OR REPLACE INTO meta (key, value) VALUES ('savings_target', ?)`).run(String(cents));
    broadcast('savings:target', req.person);
    res.json({ ok: true, state: buildState(currentMonth(), req.person) });
  });

  // ---------------------------------------------------------------- accounts

  // Create an account anchored to its real balance right now.
  router.post('/accounts', auth, (req, res) => {
    const name = readName(req.body?.name);
    const cents = readAmount(req.body?.balance ?? 0, { allowNegative: true });
    const clash = activeAccounts().some((a) => a.name.toLowerCase() === name.toLowerCase());
    if (clash) throw bad('An account with that name already exists.');
    if (activeAccounts().length >= 10) throw bad('That is a lot of accounts — archive one first.');
    const now = new Date().toISOString();
    const order = db.prepare(`SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM accounts`).get().n;
    const id = db.prepare(`
      INSERT INTO accounts (name, sort_order, anchor_cents, anchor_date, anchor_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(name, order, cents, today(), now, now).lastInsertRowid;
    broadcast('account:add', req.person);
    res.status(201).json({ id, state: buildState(currentMonth(), req.person) });
  });

  // Rename, or re-anchor the balance when it has drifted from the real bank.
  router.put('/accounts/:id', auth, (req, res) => {
    const acc = db.prepare(`SELECT * FROM accounts WHERE id = ? AND archived = 0`).get(Number(req.params.id));
    if (!acc) throw notFound('Account not found.');
    const body = req.body || {};
    if (body.name !== undefined) {
      db.prepare(`UPDATE accounts SET name = ? WHERE id = ?`).run(readName(body.name), acc.id);
    }
    if (body.balance !== undefined) {
      const cents = readAmount(body.balance, { allowNegative: true });
      db.prepare(`UPDATE accounts SET anchor_cents = ?, anchor_date = ?, anchor_at = ? WHERE id = ?`)
        .run(cents, today(), new Date().toISOString(), acc.id);
    }
    broadcast('account:edit', req.person);
    res.json({ ok: true, state: buildState(currentMonth(), req.person) });
  });

  /**
   * Accounts that were removed. Nothing is ever really deleted, so a removal
   * — including an accidental one — is always undoable with its balance and
   * history intact.
   */
  router.get('/accounts/removed', auth, (req, res) => {
    const rows = db.prepare(`SELECT * FROM accounts WHERE archived = 1 ORDER BY sort_order, id`).all();
    res.json({
      accounts: rows.map((a) => ({
        id: a.id,
        name: a.name,
        anchor: toDollars(a.anchor_cents),
        anchorDate: a.anchor_date,
        // What it would show if it came back, same maths as a live account.
        balance: toDollars(accountBalanceCents(a)),
      })),
    });
  });

  /** Forget an empty removed account for good — only if nothing references it. */
  router.delete('/accounts/:id/purge', auth, (req, res) => {
    const acc = db.prepare(`SELECT * FROM accounts WHERE id = ? AND archived = 1`).get(Number(req.params.id));
    if (!acc) throw notFound('No removed account with that id.');
    const used = db.prepare(`
      SELECT (SELECT COUNT(*) FROM transactions WHERE account_id = @id)
           + (SELECT COUNT(*) FROM income_entries WHERE account_id = @id)
           + (SELECT COUNT(*) FROM transfers WHERE from_id = @id OR to_id = @id)
           + (SELECT COUNT(*) FROM categories WHERE account_id = @id) AS n
    `).get({ id: acc.id }).n;
    if (used > 0 || acc.anchor_cents !== 0) {
      throw bad('That account still holds money or history — put it back instead of deleting it.');
    }
    db.prepare(`DELETE FROM accounts WHERE id = ?`).run(acc.id);
    broadcast('account:purge', req.person);
    res.json({ ok: true, name: acc.name });
  });

  router.post('/accounts/:id/restore', auth, (req, res) => {
    const acc = db.prepare(`SELECT * FROM accounts WHERE id = ?`).get(Number(req.params.id));
    if (!acc) throw notFound('Account not found.');
    db.prepare(`UPDATE accounts SET archived = 0 WHERE id = ?`).run(acc.id);
    broadcast('account:restore', req.person);
    res.json({ ok: true, name: acc.name, state: buildState(currentMonth(), req.person) });
  });

  // Archive: history keeps its rows; the account leaves the pickers.
  router.delete('/accounts/:id', auth, (req, res) => {
    const acc = db.prepare(`SELECT * FROM accounts WHERE id = ? AND archived = 0`).get(Number(req.params.id));
    if (!acc) throw notFound('Account not found.');
    db.prepare(`UPDATE accounts SET archived = 1 WHERE id = ?`).run(acc.id);
    broadcast('account:delete', req.person);
    res.json({ ok: true, state: buildState(currentMonth(), req.person) });
  });

  // Moving money between accounts — neither income nor spending.
  router.post('/transfers', auth, (req, res) => {
    const body = req.body || {};
    const fromId = readAccount(body.from_id);
    const toId = readAccount(body.to_id);
    if (body.from_id === undefined || body.to_id === undefined) throw bad('Pick both accounts.');
    if (fromId === toId) throw bad('Pick two different accounts.');
    const amount = readAmount(body.amount);
    const date = readDate(body.date);
    if (date > today()) throw bad('Transfers cannot be in the future.');
    const note = readNote(body.note);
    const now = new Date().toISOString();
    const id = db.prepare(`
      INSERT INTO transfers (from_id, to_id, amount_cents, note, person, date, month, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(fromId, toId, amount, note, req.person, date, date.slice(0, 7), now).lastInsertRowid;
    broadcast('transfer:add', req.person);
    res.status(201).json({ id, state: buildState(date.slice(0, 7), req.person) });
  });

  router.delete('/transfers/:id', auth, (req, res) => {
    const t = db.prepare(`SELECT * FROM transfers WHERE id = ?`).get(Number(req.params.id));
    if (!t) throw notFound('Transfer not found.');
    db.prepare(`DELETE FROM transfers WHERE id = ?`).run(t.id);
    broadcast('transfer:delete', req.person);
    res.json({ ok: true, state: buildState(t.month, req.person) });
  });

  // ---------------------------------------------------------------- statement import

  const hashExists = db.prepare(`
    SELECT (SELECT COUNT(*) FROM transactions WHERE import_hash = @h) +
           (SELECT COUNT(*) FROM income_entries WHERE import_hash = @h) AS n
  `);
  // Reconciliation: a statement row that matches something entered by hand.
  // Banks post a few days after the purchase, so the match window is the
  // amount plus a date within ±3 days. Tap-to-pay bill payments count too.
  const manualMatch = db.prepare(`
    SELECT t.id, t.date, t.note, t.person, c.name AS category
    FROM transactions t JOIN categories c ON c.id = t.category_id
    WHERE t.amount_cents = @cents AND t.source != 'import'
      AND t.date BETWEEN @lo AND @hi
    ORDER BY ABS(julianday(t.date) - julianday(@date)) LIMIT 1
  `);
  const manualIncomeMatch = db.prepare(`
    SELECT id, date, label, person FROM income_entries
    WHERE amount_cents = @cents AND import_hash IS NULL
      AND date BETWEEN @lo AND @hi
    ORDER BY ABS(julianday(date) - julianday(@date)) LIMIT 1
  `);
  const ruleFor = db.prepare(`SELECT category_id FROM merchant_rules WHERE merchant = ?`);
  const upsertRule = db.prepare(`
    INSERT INTO merchant_rules (merchant, category_id, updated_at) VALUES (?, ?, ?)
    ON CONFLICT (merchant) DO UPDATE SET category_id = excluded.category_id, updated_at = excluded.updated_at
  `);

  router.post('/import/preview', auth, async (req, res) => {
    let parsed;
    if (req.body?.pdf) {
      const b64 = String(req.body.pdf);
      if (b64.length > 12_000_000) throw bad('That PDF is too large.');
      let lines;
      try {
        lines = await extractLines(Buffer.from(b64, 'base64'));
      } catch (err) {
        throw bad('Could not read that PDF. If it is a scanned image, use the CSV export instead.');
      }
      parsed = parsePdfLines(lines, today());
      if (!parsed.rows.length && lines.length < 3) {
        throw bad('That PDF has no readable text — it may be a scan. Use the CSV export instead.');
      }
    } else {
      const text = String(req.body?.text ?? '');
      if (!text.trim()) throw bad('Paste or upload a statement first.');
      if (text.length > 2_000_000) throw bad('That file is too large.');
      parsed = parseStatement(text);
    }
    const { rows, format } = parsed;
    const active = q.categories.all().filter((c) => !c.starts_month || c.starts_month <= currentMonth());
    const byName = new Map(active.map((c) => [c.name, c.id]));

    const preview = rows.slice(0, 400).map((r, i) => {
      const hash = importHash(r.date, r.cents, r.description);
      const alreadyImported = hashExists.get({ h: hash }).n > 0;
      // Statements are the bank's record of what already happened, so unlike
      // manual entry they may land in any past month — just never the future.
      const writable = r.date <= today();
      const key = merchantKey(r.description);

      let categoryId = null;
      let guessedBy = null;
      if (r.direction === 'out') {
        const rule = key ? ruleFor.get(key) : null;
        if (rule && active.some((c) => c.id === rule.category_id)) {
          categoryId = rule.category_id;
          guessedBy = 'learned';
        } else {
          const name = keywordGuess(r.description);
          if (name && byName.has(name)) {
            categoryId = byName.get(name);
            guessedBy = 'keyword';
          }
        }
      }

      let match = null;
      if (!alreadyImported) {
        const win = { cents: r.cents, date: r.date, lo: addDays(r.date, -3), hi: addDays(r.date, 3) };
        if (r.direction === 'out') {
          const m = manualMatch.get(win);
          if (m) match = { date: m.date, label: m.category + (m.note ? ' — ' + m.note : ''), person: m.person };
        } else {
          const m = manualIncomeMatch.get(win);
          if (m) match = { date: m.date, label: m.label, person: m.person };
        }
      }

      return {
        i,
        date: r.date,
        description: r.description,
        amount: toDollars(r.cents),
        direction: r.direction,
        category_id: categoryId,
        guessedBy,
        // Moving money between your own accounts is neither income nor
        // spending — flag it so the UI leaves it unchecked.
        transfer: /\btransfer\b.{0,12}\b(to|from)\b|\bonline transfer\b/i.test(r.description),
        alreadyImported,
        maybeManual: match !== null,
        match,
        writable,
      };
    });

    res.json({
      format,
      total: rows.length,
      truncated: rows.length > 400,
      rows: preview,
    });
  });

  router.post('/import/commit', auth, (req, res) => {
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
    if (!rows.length) throw bad('Nothing selected to import.');
    if (rows.length > 400) throw bad('Too many rows at once.');

    let added = 0;
    let addedIncome = 0;
    let skipped = 0;
    // The whole statement belongs to one account, chosen up front.
    const accountId = readAccount(req.body?.account_id);
    const now = new Date().toISOString();

    db.transaction(() => {
      for (const raw of rows) {
        const amount = readAmount(raw.amount);
        const date = readDate(raw.date);
        if (date > today()) throw bad('Statement rows cannot be in the future.');
        const description = String(raw.description ?? '').trim().slice(0, 120);
        const hash = importHash(date, amount, description);
        if (hashExists.get({ h: hash }).n > 0) { skipped++; continue; }

        if (raw.direction === 'in') {
          db.prepare(`
            INSERT INTO income_entries (source_id, label, amount_cents, note, person, date, month, created_at, updated_at, import_hash, account_id)
            VALUES (NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            (merchantKey(description) || 'Deposit').slice(0, 60),
            amount, description, req.person, date, date.slice(0, 7), now, now, hash, accountId
          );
          addedIncome++;
        } else {
          const category = activeCategory(raw.category_id);
          requireStarted(category, date.slice(0, 7));
          db.prepare(`
            INSERT INTO transactions (category_id, amount_cents, note, person, date, month, source, created_at, updated_at, import_hash, account_id)
            VALUES (?, ?, ?, ?, ?, ?, 'import', ?, ?, ?, ?)
          `).run(category.id, amount, description, req.person, date, date.slice(0, 7), now, now, hash, accountId);
          added++;

          const key = merchantKey(description);
          if (key) upsertRule.run(key, category.id, now);
        }
      }
    })();

    broadcast('import:done', req.person);
    res.status(201).json({ added, addedIncome, skipped, state: buildState(currentMonth(), req.person) });
  });

  // ---------------------------------------------------------------- backups

  router.get('/backup/status', auth, (req, res) => {
    const backups = listBackups(db);
    res.json({
      last: db.prepare(`SELECT value FROM meta WHERE key = 'backup_last'`).get()?.value || null,
      count: backups.length,
      newest: backups[0] || null,
    });
  });

  // A fresh snapshot the phone downloads and keeps — the off-server copy.
  router.get('/backup/download', auth, async (req, res) => {
    const snap = await snapshotForDownload(db, today());
    if (!snap) throw bad('This database cannot be backed up.');
    res.download(snap, 'lattimer-budget-' + today() + '.db', () => {
      fs.unlink(snap, () => {});
    });
  });

  // Runs the nightly snapshot right now (also lets the family verify it works).
  router.post('/backup/run', auth, async (req, res) => {
    const dest = await runBackup(db, today());
    db.prepare(`INSERT OR REPLACE INTO meta (key, value) VALUES ('backup_last', ?)`).run(today());
    res.json({ ok: Boolean(dest), backups: listBackups(db).length });
  });

  // ---------------------------------------------------------------- budget tune-up

  // Four Walls (Ramsey): food, utilities, shelter, transportation come first.
  // On the everyday side of this budget, that means groceries and fuel are
  // protected — cuts land on lifestyle categories before essentials.
  const FOUR_WALLS = new Set(['Groceries', 'Fuel']);

  /**
   * Zero-based, Ramsey-style suggestions. The one hard rule: the plan never
   * spends more than comes in. When historical spending fits under income,
   * budgets track reality and the surplus is called out for savings or debt
   * (give every dollar a job). When it doesn't fit, this proposes CUTS —
   * scaling lifestyle categories down first, essentials last — until
   * bills + everyday + savings goal ≤ income.
   */
  function computeSuggestions(month) {
    // Plans whichever month is being looked at, so a shortfall that starts in
    // a future month can be solved before it arrives.
    const cur = isValidMonth(month) ? month : currentMonth();
    const pastMonths = q.months.all()
      .map((r) => r.month)
      .filter((m) => m < cur)
      .slice(0, 3);

    const spentIn = db.prepare(`
      SELECT COALESCE(SUM(amount_cents), 0) AS n FROM transactions WHERE month = ? AND category_id = ?
    `);

    const incomeC = liveIncomeCents();
    const active = q.categories.all().filter((c) => !c.starts_month || c.starts_month <= cur);
    const fixedC = active.filter((c) => c.kind === 'fixed')
      .reduce((s, c) => s + monthlyBudgetCents(c, cur), 0);
    const savingsC = Number(db.prepare(`SELECT value FROM meta WHERE key = 'savings_target'`).get()?.value ?? 0);
    const availableC = incomeC - fixedC - savingsC;

    // What each everyday category really costs: history where it exists,
    // the current budget as the proxy where it doesn't.
    const rows = active.filter((c) => c.kind === 'variable').map((c) => {
      const history = pastMonths.map((m) => spentIn.get(m, c.id).n);
      const withSpend = history.filter((n) => n > 0);
      const avg = withSpend.length ? withSpend.reduce((s, n) => s + n, 0) / withSpend.length : null;
      return {
        cat: c,
        avg,
        lastMonth: history[0] ?? 0,
        proxy: avg ?? c.budget_cents,
        essential: FOUR_WALLS.has(c.name),
      };
    });

    const floor5 = (n) => Math.max(0, Math.floor(n / 500) * 500);
    const sumProxy = rows.reduce((s, r) => s + r.proxy, 0);
    const fits = sumProxy <= availableC;

    let targets;
    if (fits) {
      // Round DOWN to the nearest $5: a suggestion must never ask for more
      // than history actually shows. A category with no history keeps its
      // budget rather than drifting down for no reason.
      targets = rows.map((r) => ({
        ...r,
        target: r.avg === null ? r.cat.budget_cents : floor5(r.proxy),
      }));
    } else {
      // Cuts: shrink lifestyle first, protect the four walls.
      const essC = rows.filter((r) => r.essential).reduce((s, r) => s + r.proxy, 0);
      const nonEssC = sumProxy - essC;
      const overC = sumProxy - Math.max(0, availableC);
      if (nonEssC >= overC && nonEssC > 0) {
        const factor = (nonEssC - overC) / nonEssC;
        targets = rows.map((r) => ({ ...r, target: r.essential ? floor5(r.proxy) : floor5(r.proxy * factor) }));
      } else {
        // Even zeroing lifestyle isn't enough: essentials shrink too.
        const remainC = Math.max(0, availableC);
        const factor = essC > 0 ? remainC / essC : 0;
        targets = rows.map((r) => ({ ...r, target: r.essential ? floor5(r.proxy * factor) : 0 }));
      }
    }

    const suggestions = targets
      .filter((r) => Math.abs(r.target - r.cat.budget_cents) >= 500)
      .map((r) => ({
        category_id: r.cat.id,
        name: r.cat.name,
        essential: r.essential,
        current: toDollars(r.cat.budget_cents),
        lastMonth: toDollars(r.lastMonth),
        average: r.avg === null ? null : toDollars(Math.round(r.avg)),
        suggested: toDollars(r.target),
        delta: toDollars(r.target - r.cat.budget_cents),
        why: fits
          ? 'tracks what you actually spend'
          : (r.essential ? 'four walls — protected, trimmed last' : 'cut to live on less than you make'),
      }));

    const currentTotal = active.reduce((s, c) => s + monthlyBudgetCents(c, cur), 0);
    const variableAfterC = targets.reduce((s, r) => s + r.target, 0);
    const projectedC = fixedC + variableAfterC;
    const leftoverC = incomeC - projectedC - savingsC;

    return {
      monthsConsidered: pastMonths,
      mode: fits ? 'fits' : 'cut',
      suggestions,
      totals: {
        income: toDollars(incomeC),
        bills: toDollars(fixedC),
        savingsGoal: toDollars(savingsC),
        current: toDollars(currentTotal),
        ifAllApplied: toDollars(projectedC),
        leftover: toDollars(Math.max(0, leftoverC)),
      },
    };
  }

  router.get('/budget/suggestions', auth, (req, res) => {
    res.json(computeSuggestions(req.query.month));
  });

  // ---------------------------------------------------------------- Ramsey coach

  // Ramsey's recommended budget percentage bands (of take-home pay).
  const RAMSEY_BANDS = [
    { group: 'Giving', lo: 10, hi: 10, names: ['Church giving'] },
    { group: 'Housing', lo: 0, hi: 25, names: ['Mortgage (Rocket)'] },
    { group: 'Food', lo: 10, hi: 15, names: ['Groceries'] },
    { group: 'Utilities', lo: 5, hi: 10, names: ['Natural gas', 'Electric', 'Water/sewer', 'AT&T phones'] },
    { group: 'Transportation', lo: 0, hi: 10, names: ['Fuel', 'Truck (Credit Acceptance)', "Miriam's lease", 'Vehicle parts & maintenance'] },
    { group: 'Insurance', lo: 10, hi: 25, names: ['GEICO'] },
    { group: 'Lifestyle', lo: 5, hi: 10, names: ['Eating out & fun', 'Personal - Chris', 'Personal - Miriam', 'Apple services', 'Disney+', 'Pestie', 'Fabletics', 'Kindle Unlimited', 'Bitwarden', 'Ring', 'Subscriptions'] },
    { group: 'Debt payoff', lo: 0, hi: 10, names: ['Discover', 'Apple Card', 'Dirt bike (Lendmark)', "Miriam's student loans", 'Settlement fund'] },
    { group: 'Childcare', lo: 0, hi: 0, names: ['Child care (Kids Country)'], note: 'a necessity Ramsey budgets under essentials — no band' },
  ];

  router.get('/plan/coach', auth, (req, res) => {
    const cur = currentMonth();
    const incomeC = liveIncomeCents();
    const active = q.categories.all().filter((c) => !c.starts_month || c.starts_month <= cur);

    // Percentage bands vs the current plan
    const named = new Set(RAMSEY_BANDS.flatMap((b) => b.names));
    const bands = RAMSEY_BANDS.map((b) => {
      const cents = active.filter((c) => b.names.includes(c.name))
        .reduce((s, c) => s + monthlyBudgetCents(c, cur), 0);
      const pct = incomeC > 0 ? Math.round((cents / incomeC) * 1000) / 10 : 0;
      return {
        group: b.group,
        lo: b.lo,
        hi: b.hi,
        amount: toDollars(cents),
        pct,
        note: b.note || null,
        status: b.note ? 'info' : pct > b.hi ? 'over' : pct < b.lo ? 'under' : 'ok',
      };
    });
    const otherC = active.filter((c) => !named.has(c.name))
      .reduce((s, c) => s + monthlyBudgetCents(c, cur), 0);
    bands.push({
      group: 'Everything else', lo: 0, hi: 10,
      amount: toDollars(otherC),
      pct: incomeC > 0 ? Math.round((otherC / incomeC) * 1000) / 10 : 0,
      note: null,
      status: otherC / incomeC > 0.10 ? 'over' : 'ok',
    });

    // Baby Steps
    const savingsC = db.prepare(`SELECT COALESCE(SUM(amount_cents), 0) AS n FROM savings_entries`).get().n;
    const debts = q.debts.all();
    const open = debts.filter((d) => !d.settled);
    // Snowball order: the lawsuit gets settled first, then smallest balance.
    const snowball = open
      .slice()
      .sort((a, b) => (/lawsuit/i.test(b.label) ? 1 : 0) - (/lawsuit/i.test(a.label) ? 1 : 0) || a.balance_cents - b.balance_cents)
      .map((d) => ({ name: d.name, balance: toDollars(d.balance_cents), target: toDollars(d.target_cents), label: d.label }));

    const past3 = q.months.all().map((r) => r.month).filter((m) => m < cur).slice(0, 3);
    const spendRows = past3.map((m) => db.prepare(`SELECT COALESCE(SUM(amount_cents),0) AS n FROM transactions WHERE month = ?`).get(m).n);
    const avgSpendC = spendRows.length ? spendRows.reduce((s, n) => s + n, 0) / spendRows.length : incomeC;
    const threeMonthsC = Math.round(avgSpendC * 3);

    const steps = [
      { n: 1, title: 'Save a $1,000 starter emergency fund',
        done: savingsC >= 100000, progress: Math.min(100, Math.round(savingsC / 1000)), detail: '$' + toDollars(savingsC).toFixed(0) + ' of $1,000 saved' },
      { n: 2, title: 'Pay off all debt but the house (debt snowball)',
        done: open.length === 0,
        progress: debts.length ? Math.round(((debts.length - open.length) / debts.length) * 100) : 0,
        detail: (debts.length - open.length) + ' of ' + debts.length + ' settlement targets cleared', snowball },
      { n: 3, title: 'Save 3–6 months of expenses',
        done: savingsC >= threeMonthsC && threeMonthsC > 0,
        progress: threeMonthsC > 0 ? Math.min(100, Math.round((savingsC / threeMonthsC) * 100)) : 0,
        detail: '$' + toDollars(savingsC).toFixed(0) + ' of ~$' + toDollars(threeMonthsC).toFixed(0) + ' (3 months at your real spending)' },
      { n: 4, title: 'Invest 15% of household income for retirement', done: false, progress: 0, detail: 'after steps 1–3' },
      { n: 5, title: "Save for the kids' college", done: false, progress: 0, detail: 'after step 4' },
      { n: 6, title: 'Pay off the house early', done: false, progress: 0, detail: 'after step 5' },
      { n: 7, title: 'Build wealth and give', done: false, progress: 0, detail: 'the goal line' },
    ];
    const currentStep = (steps.find((s) => !s.done) || steps[6]).n;

    res.json({ currentStep, steps, bands, income: toDollars(incomeC) });
  });

  router.post('/budget/apply', auth, (req, res) => {
    const changes = Array.isArray(req.body?.changes) ? req.body.changes : [];
    if (!changes.length) throw bad('Nothing to apply.');
    if (changes.length > 100) throw bad('Too many changes at once.');

    // Zero-based guard: an apply may never PUSH the plan above income.
    // (Applies that reduce an already-over plan are always allowed.)
    const cur = currentMonth();
    const incomeC = liveIncomeCents();
    const deltas = new Map(changes.map((ch) => [Number(ch.category_id), readAmount(ch.budget, { allowNegative: true })]));
    const active = q.categories.all().filter((c) => !c.starts_month || c.starts_month <= cur);
    const totalOf = (useNew) => active.reduce((s, c) => {
      if (useNew && deltas.has(c.id) && !c.percent_income && c.cadence !== 'payday') {
        return s + deltas.get(c.id);
      }
      return s + monthlyBudgetCents(c, cur);
    }, 0);
    const oldTotal = totalOf(false);
    const newTotal = totalOf(true);
    if (newTotal > incomeC && newTotal > oldTotal) {
      throw bad('That plan would spend more than you make (' +
        '$' + toDollars(newTotal).toFixed(0) + ' of $' + toDollars(incomeC).toFixed(0) +
        '). Income minus outgo can never go below zero — cut somewhere else first.');
    }

    db.transaction(() => {
      for (const change of changes) {
        const category = activeCategory(change.category_id);
        const budget = readAmount(change.budget, { allowNegative: true });
        if (budget < 0) throw bad('Budget cannot be negative.');
        db.prepare(`UPDATE categories SET budget_cents = ? WHERE id = ?`).run(budget, category.id);
      }
    })();

    broadcast('budget:tuned', req.person);
    res.json({ ok: true, applied: changes.length, state: buildState(currentMonth(), req.person) });
  });

  // ---------------------------------------------------------------- errors

  router.use((req, res) => res.status(404).json({ error: 'Not found.' }));

  // eslint-disable-next-line no-unused-vars
  router.use((err, req, res, next) => {
    const status = err.status || 500;
    if (status >= 500) console.error(err);
    res.status(status).json({ error: err.message || 'Something went wrong.' });
  });

  // runAutoPay lets the scheduler tick auto-drafts over on their due day even
  // if neither phone opens the app.
  return {
    router,
    broadcast,
    runAutoPay: () => autoPayDueBills(currentMonth()),
    clientCount: () => clients.size,
  };
}

module.exports = { createApi, HttpError };
