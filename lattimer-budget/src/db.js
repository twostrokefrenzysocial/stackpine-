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
  return db;
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
  `);
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
    for (const [name, dollars] of seed.FIXED) {
      insertCategory.run(name, 'fixed', Math.round(dollars * 100), order++);
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

module.exports = { open, DEFAULT_DB_PATH };
