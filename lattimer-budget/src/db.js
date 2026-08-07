'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const seed = require('./seed');

const DEFAULT_DB_PATH = path.join(process.cwd(), 'data', 'budget.db');

function open(dbPath = process.env.DB_PATH || DEFAULT_DB_PATH) {
  if (dbPath !== ':memory:') {
    fs.mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });
  }
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrate(db);
  seedOnce(db);
  applyDataMigrations(db);
  return db;
}

function addColumnIfMissing(db, table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (columns.some((c) => c.name === column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS meta (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS categories (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      name         TEXT NOT NULL UNIQUE,
      kind         TEXT NOT NULL CHECK (kind IN ('fixed', 'variable')),
      budget_cents INTEGER NOT NULL DEFAULT 0,
      sort_order   INTEGER NOT NULL DEFAULT 0,
      archived     INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS income_sources (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      name         TEXT NOT NULL,
      person       TEXT NOT NULL DEFAULT '',
      amount_cents INTEGER NOT NULL DEFAULT 0,
      per_month    INTEGER NOT NULL DEFAULT 1,
      sort_order   INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS transactions (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      category_id  INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
      amount_cents INTEGER NOT NULL,
      note         TEXT NOT NULL DEFAULT '',
      person       TEXT NOT NULL,
      date         TEXT NOT NULL,
      month        TEXT NOT NULL,
      source       TEXT NOT NULL DEFAULT 'manual',
      created_at   TEXT NOT NULL,
      updated_at   TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_tx_month ON transactions (month);
    CREATE INDEX IF NOT EXISTS idx_tx_month_cat ON transactions (month, category_id);

    CREATE TABLE IF NOT EXISTS debts (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      name           TEXT NOT NULL,
      balance_cents  INTEGER NOT NULL DEFAULT 0,
      target_cents   INTEGER NOT NULL DEFAULT 0,
      label          TEXT NOT NULL DEFAULT '',
      sort_order     INTEGER NOT NULL DEFAULT 0,
      settled        INTEGER NOT NULL DEFAULT 0,
      settled_cents  INTEGER,
      settled_date   TEXT,
      settled_by     TEXT
    );

    CREATE TABLE IF NOT EXISTS fund_deposits (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      amount_cents INTEGER NOT NULL,
      note         TEXT NOT NULL DEFAULT '',
      person       TEXT NOT NULL,
      date         TEXT NOT NULL,
      created_at   TEXT NOT NULL
    );

    -- Per-month snapshots so a past month keeps the budget it was actually run on.
    CREATE TABLE IF NOT EXISTS month_budgets (
      month        TEXT NOT NULL,
      category_id  INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
      name         TEXT NOT NULL,
      kind         TEXT NOT NULL,
      budget_cents INTEGER NOT NULL,
      sort_order   INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (month, category_id)
    );

    CREATE TABLE IF NOT EXISTS month_income (
      month        TEXT PRIMARY KEY,
      income_cents INTEGER NOT NULL
    );

    -- Actual money received: paychecks as they land (amounts vary check to
    -- check), plus one-off income with no source attached.
    CREATE TABLE IF NOT EXISTS income_entries (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      source_id    INTEGER REFERENCES income_sources(id) ON DELETE SET NULL,
      label        TEXT NOT NULL DEFAULT '',
      amount_cents INTEGER NOT NULL,
      note         TEXT NOT NULL DEFAULT '',
      person       TEXT NOT NULL,
      date         TEXT NOT NULL,
      month        TEXT NOT NULL,
      created_at   TEXT NOT NULL,
      updated_at   TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_income_entries_month ON income_entries (month);
  `);

  // A bill that begins in a future month (YYYY-MM); NULL means "already active".
  addColumnIfMissing(db, 'categories', 'starts_month', 'TEXT');
  // Day of the month a fixed bill is due (1-31); NULL means no due date.
  addColumnIfMissing(db, 'categories', 'due_day', 'INTEGER');
  // Statement-import identity so re-importing the same file never duplicates.
  addColumnIfMissing(db, 'transactions', 'import_hash', 'TEXT');
  addColumnIfMissing(db, 'income_entries', 'import_hash', 'TEXT');
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_tx_import ON transactions (import_hash);
    CREATE INDEX IF NOT EXISTS idx_income_import ON income_entries (import_hash);

    -- Which category a merchant belongs to, learned from what the family
    -- picked on previous imports.
    CREATE TABLE IF NOT EXISTS merchant_rules (
      merchant    TEXT PRIMARY KEY,
      category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
      updated_at  TEXT NOT NULL
    );

    -- The savings ledger: positive = money put away, negative = taken out.
    CREATE TABLE IF NOT EXISTS savings_entries (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      amount_cents INTEGER NOT NULL,
      note         TEXT NOT NULL DEFAULT '',
      person       TEXT NOT NULL,
      date         TEXT NOT NULL,
      created_at   TEXT NOT NULL
    );

    -- Named savings goals ("Christmas", "Emergency fund").
    CREATE TABLE IF NOT EXISTS savings_goals (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      name         TEXT NOT NULL,
      target_cents INTEGER NOT NULL DEFAULT 0,
      sort_order   INTEGER NOT NULL DEFAULT 0,
      created_at   TEXT NOT NULL
    );

    -- One row per phone that turned on notifications.
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      endpoint   TEXT PRIMARY KEY,
      keys_json  TEXT NOT NULL,
      person     TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);

  // Savings entries can belong to a named goal.
  addColumnIfMissing(db, 'savings_entries', 'goal_id', 'INTEGER REFERENCES savings_goals(id) ON DELETE SET NULL');
  // Payday tracking: the next expected check date and how often it repeats.
  addColumnIfMissing(db, 'income_sources', 'next_date', 'TEXT');
  addColumnIfMissing(db, 'income_sources', 'cadence', 'TEXT');
  // Bills that repeat every payday instead of once a month (tithing). For
  // these, budget_cents is the PER-PAYMENT amount.
  addColumnIfMissing(db, 'categories', 'cadence', 'TEXT');
  // Percent-of-income bills: tithe is 10% of net income, not a fixed number.
  addColumnIfMissing(db, 'categories', 'percent_income', 'INTEGER');
  // Which paycheck a bill gets paid with. The family doesn't wait for the due
  // date — bills are paid the moment a check lands, most on a 28-day rhythm,
  // so each one belongs to alternating paydays: 0 = this cycle, 1 = the next.
  addColumnIfMissing(db, 'categories', 'due_payday', 'INTEGER');
  // Offline Quick Add: a phone-generated id so an entry queued without signal
  // is inserted exactly once, no matter how many times the sync retries.
  addColumnIfMissing(db, 'transactions', 'client_id', 'TEXT');
  addColumnIfMissing(db, 'income_entries', 'client_id', 'TEXT');
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_tx_client ON transactions (client_id) WHERE client_id IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_income_client ON income_entries (client_id) WHERE client_id IS NOT NULL;

    -- The family's real accounts (checking, savings, business…). Each is
    -- anchored to its true balance once; logged money moves it from there.
    CREATE TABLE IF NOT EXISTS accounts (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      name         TEXT NOT NULL,
      sort_order   INTEGER NOT NULL DEFAULT 0,
      archived     INTEGER NOT NULL DEFAULT 0,
      anchor_cents INTEGER NOT NULL DEFAULT 0,
      anchor_date  TEXT NOT NULL,
      anchor_at    TEXT NOT NULL,
      created_at   TEXT NOT NULL
    );

    -- Money moved between accounts: not income, not spending.
    CREATE TABLE IF NOT EXISTS transfers (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      from_id      INTEGER NOT NULL REFERENCES accounts(id),
      to_id        INTEGER NOT NULL REFERENCES accounts(id),
      amount_cents INTEGER NOT NULL,
      note         TEXT NOT NULL DEFAULT '',
      person       TEXT NOT NULL,
      date         TEXT NOT NULL,
      month        TEXT NOT NULL,
      created_at   TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_transfers_month ON transfers (month);
  `);
  // Which account an entry touched; NULL (legacy rows) reads as the first one.
  addColumnIfMissing(db, 'transactions', 'account_id', 'INTEGER REFERENCES accounts(id)');
  addColumnIfMissing(db, 'income_entries', 'account_id', 'INTEGER REFERENCES accounts(id)');

  // A single-balance anchor from before accounts existed becomes account #1.
  const oldAnchor = db.prepare(`SELECT value FROM meta WHERE key = 'bank_anchor'`).get()?.value;
  if (oldAnchor && db.prepare(`SELECT COUNT(*) AS n FROM accounts`).get().n === 0) {
    try {
      const a = JSON.parse(oldAnchor);
      db.prepare(`
        INSERT INTO accounts (name, sort_order, anchor_cents, anchor_date, anchor_at, created_at)
        VALUES ('Checking', 0, ?, ?, ?, ?)
      `).run(a.cents, a.date, a.at, new Date().toISOString());
    } catch (err) { /* malformed anchor — start clean */ }
    db.prepare(`DELETE FROM meta WHERE key = 'bank_anchor'`).run();
  }
}

function seedOnce(db) {
  const done = db.prepare(`SELECT value FROM meta WHERE key = 'seeded'`).get();
  if (done) return;

  const insertCategory = db.prepare(
    `INSERT INTO categories (name, kind, budget_cents, sort_order) VALUES (?, ?, ?, ?)`
  );
  const insertIncome = db.prepare(
    `INSERT INTO income_sources (name, person, amount_cents, per_month, sort_order) VALUES (?, ?, ?, ?, ?)`
  );
  const insertDebt = db.prepare(
    `INSERT INTO debts (name, balance_cents, target_cents, label, sort_order) VALUES (?, ?, ?, ?, ?)`
  );

  db.transaction(() => {
    let order = 0;
    for (const [name, dollars, opts] of seed.FIXED) {
      insertCategory.run(name, 'fixed', Math.round(dollars * 100), order++);
      if (opts && opts.startsMonth) {
        db.prepare(`UPDATE categories SET starts_month = ? WHERE name = ?`).run(opts.startsMonth, name);
      }
    }
    order = 0;
    for (const [name, dollars] of seed.VARIABLE) {
      insertCategory.run(name, 'variable', Math.round(dollars * 100), order++);
    }
    seed.INCOME.forEach((src, i) => {
      insertIncome.run(src.name, src.person, Math.round(src.amount * 100), src.per_month, i);
    });
    seed.DEBTS.forEach((d, i) => {
      insertDebt.run(d.name, Math.round(d.balance * 100), Math.round(d.target * 100), d.label, i);
    });
    db.prepare(`INSERT INTO meta (key, value) VALUES ('seeded', ?)`).run(new Date().toISOString());
  })();
}

/**
 * Applies each entry in seed.DATA_MIGRATIONS at most once. This is what lets a
 * budget that is already deployed pick up a new bill, since seeding only ever
 * runs against a brand-new database.
 */
function applyDataMigrations(db) {
  const done = db.prepare(`SELECT 1 FROM meta WHERE key = ?`);
  const mark = db.prepare(`INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)`);

  for (const migration of seed.DATA_MIGRATIONS) {
    if (done.get(migration.key)) continue;

    db.transaction(() => {
      if (migration.paydays) {
        db.prepare(`UPDATE income_sources SET next_date = ?, cadence = ? WHERE next_date IS NULL`)
          .run(migration.paydays.next_date, migration.paydays.cadence);
      }
      if (migration.billCadence) {
        db.prepare(`UPDATE categories SET cadence = ?, budget_cents = ? WHERE name = ? AND archived = 0`)
          .run(migration.billCadence.cadence, Math.round(migration.billCadence.perPay * 100), migration.billCadence.name);
      }
      if (migration.percentBill) {
        db.prepare(`UPDATE categories SET percent_income = ? WHERE name = ? AND archived = 0`)
          .run(migration.percentBill.percent, migration.percentBill.name);
      }
      if (migration.split) {
        db.prepare(`UPDATE categories SET archived = 1 WHERE name = ?`).run(migration.split.archive);
        for (const [name, dollars] of migration.split.categories) {
          const exists = db.prepare(`SELECT id FROM categories WHERE name = ?`).get(name);
          if (exists) continue;
          const order = db.prepare(`SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM categories WHERE kind = 'variable'`).get().n;
          db.prepare(`INSERT INTO categories (name, kind, budget_cents, sort_order) VALUES (?, 'variable', ?, ?)`)
            .run(name, Math.round(dollars * 100), order);
        }
      }
      if (migration.paydayDueDates) {
        for (const [name, parity] of Object.entries(migration.paydayDueDates)) {
          db.prepare(`UPDATE categories SET due_payday = ?, due_day = NULL WHERE name = ? AND archived = 0`)
            .run(parity, name);
        }
      }
      if (migration.dueDays) {
        for (const [name, day] of Object.entries(migration.dueDays)) {
          db.prepare(`UPDATE categories SET due_day = ?, due_payday = NULL WHERE name = ? AND archived = 0`)
            .run(day, name);
        }
      }
      if (migration.toFixed) {
        // Reclassify spending categories as fixed bills (subscriptions are
        // bills, not everyday spending). History stays attached.
        for (const name of migration.toFixed) {
          const row = db.prepare(`SELECT id FROM categories WHERE name = ? AND archived = 0 AND kind = 'variable'`).get(name);
          if (!row) continue;
          const order = db.prepare(`SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM categories WHERE kind = 'fixed'`).get().n;
          db.prepare(`UPDATE categories SET kind = 'fixed', sort_order = ? WHERE id = ?`).run(order, row.id);
        }
      }
      const spec = migration.category;
      if (spec) {
        const existing = db.prepare(`SELECT id FROM categories WHERE name = ?`).get(spec.name);
        if (!existing) {
          // Slot it in after a named sibling so the checklist stays in a sensible order.
          const anchor = spec.after
            ? db.prepare(`SELECT sort_order FROM categories WHERE name = ? AND kind = ?`).get(spec.after, spec.kind)
            : null;
          const order = anchor
            ? anchor.sort_order + 1
            : db.prepare(`SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM categories WHERE kind = ?`).get(spec.kind).n;

          if (anchor) {
            db.prepare(`UPDATE categories SET sort_order = sort_order + 1 WHERE kind = ? AND sort_order >= ?`)
              .run(spec.kind, order);
          }
          db.prepare(`
            INSERT INTO categories (name, kind, budget_cents, sort_order, starts_month)
            VALUES (?, ?, ?, ?, ?)
          `).run(spec.name, spec.kind, Math.round(spec.budget * 100), order, spec.startsMonth || null);
        }
      }
      mark.run(migration.key, new Date().toISOString());
    })();
  }
}

module.exports = { open, DEFAULT_DB_PATH };
