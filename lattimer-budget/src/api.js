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
      SELECT category_id, SUM(amount_cents) AS paid_cents, COUNT(*) AS n
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

  /** Keep the current month's snapshot in step with live settings. */
  const syncCurrentMonth = db.transaction((month) => {
    for (const c of q.categories.all()) {
      // A bill scheduled to begin later stays off the budget until its month.
      if (c.starts_month && c.starts_month > month) continue;
      q.upsertMonthRow.run({
        month,
        category_id: c.id,
        name: c.name,
        kind: c.kind,
        budget_cents: c.budget_cents,
        sort_order: c.sort_order,
      });
    }
    q.deleteStaleMonthRows.run({ month });
    q.upsertMonthIncome.run(month, liveIncomeCents());
  });

  /** A past month keeps whatever it was budgeted at; seed it once if never seen. */
  function ensureMonth(month) {
    if (month === currentMonth()) {
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

  function buildState(month, person) {
    ensureMonth(month);

    const spentMap = new Map(q.spentByCategory.all(month).map((r) => [r.category_id, r.spent]));
    const paidMap = new Map(q.billPaidRows.all(month).map((r) => [r.category_id, r]));
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
    const isCurrent = month === currentMonth();

    const categories = q.monthRows.all(month).map((row) => {
      const spent = spentMap.get(row.category_id) ?? 0;
      const budget = row.budget_cents;
      const pct = budget > 0 ? (spent / budget) * 100 : spent > 0 ? 101 : 0;
      const paidRow = paidMap.get(row.category_id);

      // Due-date state, only meaningful for an unpaid bill in the live month.
      const dueDay = dueDays.get(row.category_id) ?? null;
      const dueDate = dueDay ? dueDateIn(month, dueDay) : null;
      let dueIn = null;
      let dueStatus = null;
      if (dueDate && isCurrent && !paidRow) {
        dueIn = daysUntil(dueDate);
        dueStatus = dueIn < 0 ? 'overdue' : dueIn === 0 ? 'today' : dueIn <= 3 ? 'soon' : 'later';
      }

      return {
        id: row.category_id,
        name: row.name,
        kind: row.kind,
        dueDay,
        dueDate,
        dueIn,
        dueStatus,
        budget: toDollars(budget),
        spent: toDollars(spent),
        remaining: toDollars(budget - spent),
        pct: Math.round(pct * 10) / 10,
        status: statusFor(pct),
        // A category retired mid-month keeps showing while it still holds
        // spending, so the dashboard total always matches History.
        archived: !liveIds.has(row.category_id),
        paid: row.kind === 'fixed' ? Boolean(paidRow) : undefined,
        paidAmount: paidRow ? toDollars(paidRow.paid_cents) : undefined,
      };
    });

    // Bills with a due date come first, earliest first, so the next thing to pay
    // is at the top of the checklist. Everything else keeps its configured order.
    categories.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'fixed' ? -1 : 1;
      if (a.kind !== 'fixed') return 0;
      if (a.dueDay && b.dueDay) return a.dueDay - b.dueDay;
      if (a.dueDay) return -1;
      if (b.dueDay) return 1;
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
          return {
            id: s.id,
            name: s.name,
            person: s.person,
            amount: toDollars(s.amount_cents),
            per_month: s.per_month,
            monthly: toDollars(s.amount_cents * s.per_month),
            received: got ? toDollars(got.total) : 0,
            checks: got ? got.n : 0,
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
    res.json(lastChange);
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
    const category = activeCategory(body.category_id);
    const amount = readAmount(body.amount);
    const date = readDate(body.date);
    requireMonthWritable(date);
    requireStarted(category, date.slice(0, 7));
    const person = readPerson(body.person, req.person);
    const note = readNote(body.note);
    const now = new Date().toISOString();

    const info = db
      .prepare(`
        INSERT INTO transactions (category_id, amount_cents, note, person, date, month, source, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 'manual', ?, ?)
      `)
      .run(category.id, amount, note, person, date, date.slice(0, 7), now, now);

    broadcast('transaction:add', req.person);
    res.status(201).json({ id: info.lastInsertRowid, state: buildState(date.slice(0, 7), req.person) });
  });

  router.put('/transactions/:id', auth, (req, res) => {
    const existing = q.txById.get(Number(req.params.id));
    if (!existing) throw notFound('Transaction not found.');
    requireMonthWritable(existing.date);

    const body = req.body || {};
    const category = body.category_id === undefined
      ? q.categoryById.get(existing.category_id)
      : activeCategory(body.category_id);
    if (!category) throw notFound('Category not found.');
    const amount = body.amount === undefined ? existing.amount_cents : readAmount(body.amount);
    const date = body.date === undefined ? existing.date : readDate(body.date);
    requireMonthWritable(date);
    requireStarted(category, date.slice(0, 7));
    const person = readPerson(body.person, existing.person);
    const note = body.note === undefined ? existing.note : readNote(body.note);

    db.prepare(`
      UPDATE transactions
      SET category_id = ?, amount_cents = ?, note = ?, person = ?, date = ?, month = ?, updated_at = ?
      WHERE id = ?
    `).run(category.id, amount, note, person, date, date.slice(0, 7), new Date().toISOString(), existing.id);

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

    if (paid) {
      const snapshot = db
        .prepare(`SELECT budget_cents FROM month_budgets WHERE month = ? AND category_id = ?`)
        .get(month, category.id);
      const amount = req.body?.amount === undefined
        ? snapshot?.budget_cents ?? category.budget_cents
        : readAmount(req.body.amount);
      if (amount <= 0) throw bad('Set a budget for this bill before marking it paid.');
      const now = new Date().toISOString();
      db.transaction(() => {
        db.prepare(`DELETE FROM transactions WHERE month = ? AND category_id = ? AND source = 'billpay'`)
          .run(month, category.id);
        db.prepare(`
          INSERT INTO transactions (category_id, amount_cents, note, person, date, month, source, created_at, updated_at)
          VALUES (?, ?, 'Paid', ?, ?, ?, 'billpay', ?, ?)
        `).run(category.id, amount, req.person, date, month, now, now);
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

    const clash = db.prepare(`SELECT id, archived FROM categories WHERE name = ?`).get(name);
    if (clash && !clash.archived) throw bad('A category with that name already exists.');

    let id;
    if (clash) {
      db.prepare(`
        UPDATE categories SET archived = 0, kind = ?, budget_cents = ?, starts_month = ?, due_day = ?
        WHERE id = ?
      `).run(kind, budget, startsMonth, dueDay, clash.id);
      id = clash.id;
    } else {
      const next = db
        .prepare(`SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM categories WHERE kind = ?`)
        .get(kind).n;
      id = db
        .prepare(`
          INSERT INTO categories (name, kind, budget_cents, sort_order, starts_month, due_day)
          VALUES (?, ?, ?, ?, ?, ?)
        `)
        .run(name, kind, budget, next, startsMonth, dueDay).lastInsertRowid;
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
    const dueDay = dueRaw === undefined ? category.due_day : dueRaw;

    const clash = db.prepare(`SELECT id FROM categories WHERE name = ? AND id != ?`).get(name, category.id);
    if (clash) throw bad('A category with that name already exists.');

    db.prepare(`
      UPDATE categories SET name = ?, budget_cents = ?, kind = ?, starts_month = ?, due_day = ?
      WHERE id = ?
    `).run(name, budget, kind, startsMonth, dueDay, category.id);

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
    const amount = readAmount(body.amount);
    const date = readDate(body.date);
    requireMonthWritable(date);
    const person = readPerson(body.person, req.person);
    const note = readNote(body.note);
    const source = readIncomeSource(body.source_id);
    const rawLabel = String(body.label ?? '').trim();
    const label = (rawLabel || (source ? source.name : 'Income')).slice(0, 60);
    const now = new Date().toISOString();

    const id = db.prepare(`
      INSERT INTO income_entries (source_id, label, amount_cents, note, person, date, month, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(source ? source.id : null, label, amount, note, person, date, date.slice(0, 7), now, now).lastInsertRowid;

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

  router.post('/income', auth, (req, res) => {
    const body = req.body || {};
    const name = readName(body.name);
    const amount = readAmount(body.amount ?? 0, { allowNegative: true });
    if (amount < 0) throw bad('Income cannot be negative.');
    const perMonth = Math.max(1, Math.min(12, Math.round(Number(body.per_month ?? 1)) || 1));
    const person = body.person && PEOPLE.includes(body.person) ? body.person : '';
    const next = db.prepare(`SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM income_sources`).get().n;
    const id = db
      .prepare(`INSERT INTO income_sources (name, person, amount_cents, per_month, sort_order) VALUES (?, ?, ?, ?, ?)`)
      .run(name, person, amount, perMonth, next).lastInsertRowid;
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
    db.prepare(`UPDATE income_sources SET name = ?, person = ?, amount_cents = ?, per_month = ? WHERE id = ?`)
      .run(name, person, amount, perMonth, src.id);
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

  // ---------------------------------------------------------------- statement import

  const hashExists = db.prepare(`
    SELECT (SELECT COUNT(*) FROM transactions WHERE import_hash = @h) +
           (SELECT COUNT(*) FROM income_entries WHERE import_hash = @h) AS n
  `);
  const manualMatch = db.prepare(`
    SELECT COUNT(*) AS n FROM transactions
    WHERE date = ? AND amount_cents = ? AND source != 'import'
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
        maybeManual: !alreadyImported && r.direction === 'out'
          ? manualMatch.get(r.date, r.cents).n > 0
          : false,
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
            INSERT INTO income_entries (source_id, label, amount_cents, note, person, date, month, created_at, updated_at, import_hash)
            VALUES (NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            (merchantKey(description) || 'Deposit').slice(0, 60),
            amount, description, req.person, date, date.slice(0, 7), now, now, hash
          );
          addedIncome++;
        } else {
          const category = activeCategory(raw.category_id);
          requireStarted(category, date.slice(0, 7));
          db.prepare(`
            INSERT INTO transactions (category_id, amount_cents, note, person, date, month, source, created_at, updated_at, import_hash)
            VALUES (?, ?, ?, ?, ?, ?, 'import', ?, ?, ?)
          `).run(category.id, amount, description, req.person, date, date.slice(0, 7), now, now, hash);
          added++;

          const key = merchantKey(description);
          if (key) upsertRule.run(key, category.id, now);
        }
      }
    })();

    broadcast('import:done', req.person);
    res.status(201).json({ added, addedIncome, skipped, state: buildState(currentMonth(), req.person) });
  });

  // ---------------------------------------------------------------- budget tune-up

  function computeSuggestions() {
    const cur = currentMonth();
    const pastMonths = q.months.all()
      .map((r) => r.month)
      .filter((m) => m < cur)
      .slice(0, 3);

    const spentIn = db.prepare(`
      SELECT COALESCE(SUM(amount_cents), 0) AS n FROM transactions WHERE month = ? AND category_id = ?
    `);

    const suggestions = [];
    for (const c of q.categories.all()) {
      if (c.kind !== 'variable') continue;
      if (c.starts_month && c.starts_month > cur) continue;
      const history = pastMonths.map((m) => spentIn.get(m, c.id).n);
      const monthsWithSpend = history.filter((n) => n > 0);
      if (!monthsWithSpend.length) continue;
      const avg = monthsWithSpend.reduce((s, n) => s + n, 0) / monthsWithSpend.length;
      const suggested = Math.max(500, Math.round(avg / 500) * 500); // nearest $5, floor $5
      if (Math.abs(suggested - c.budget_cents) < 500) continue;
      suggestions.push({
        category_id: c.id,
        name: c.name,
        current: toDollars(c.budget_cents),
        lastMonth: toDollars(history[0] ?? 0),
        average: toDollars(Math.round(avg)),
        suggested: toDollars(suggested),
        delta: toDollars(suggested - c.budget_cents),
      });
    }

    const currentTotal = q.categories.all()
      .filter((c) => !c.starts_month || c.starts_month <= cur)
      .reduce((s, c) => s + c.budget_cents, 0);
    const suggestedTotal = currentTotal + suggestions.reduce((s, x) => s + Math.round(x.delta * 100), 0);

    return {
      monthsConsidered: pastMonths,
      suggestions,
      totals: {
        income: toDollars(liveIncomeCents()),
        current: toDollars(currentTotal),
        ifAllApplied: toDollars(suggestedTotal),
      },
    };
  }

  router.get('/budget/suggestions', auth, (req, res) => {
    res.json(computeSuggestions());
  });

  router.post('/budget/apply', auth, (req, res) => {
    const changes = Array.isArray(req.body?.changes) ? req.body.changes : [];
    if (!changes.length) throw bad('Nothing to apply.');
    if (changes.length > 100) throw bad('Too many changes at once.');

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

  return { router, broadcast, clientCount: () => clients.size };
}

module.exports = { createApi, HttpError };
