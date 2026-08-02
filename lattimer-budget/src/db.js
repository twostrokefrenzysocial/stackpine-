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
  `);

  // A bill that begins in a future month (YYYY-MM); NULL means "already active".
  addColumnIfMissing(db, 'categories', 'starts_month', 'TEXT');
  // Day of the month a fixed bill is due (1-31); NULL means no due date.
  addColumnIfMissing(db, 'categories', 'due_day', 'INTEGER');
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
