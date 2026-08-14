import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

const dbPath = process.env.DATABASE_PATH || './data/academy.db';
const dir = path.dirname(dbPath);
if (dir && dir !== '.' && !fs.existsSync(dir)) {
  fs.mkdirSync(dir, { recursive: true });
}

export const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  name TEXT NOT NULL DEFAULT 'Chris',
  age INTEGER NOT NULL DEFAULT 33,
  sex TEXT NOT NULL DEFAULT 'male',
  start_date TEXT NOT NULL DEFAULT '2026-08-14',
  start_weight REAL NOT NULL DEFAULT 268,
  goal_weight REAL NOT NULL DEFAULT 200,
  test_date TEXT,
  protein_min INTEGER NOT NULL DEFAULT 150,
  protein_max INTEGER NOT NULL DEFAULT 180,
  water_goal_oz INTEGER NOT NULL DEFAULT 100,
  water_goal_oz_run_day INTEGER NOT NULL DEFAULT 128,
  meal_preferences TEXT NOT NULL DEFAULT '',
  meal_exclusions TEXT NOT NULL DEFAULT '',
  household_size INTEGER NOT NULL DEFAULT 3,
  pushup_incline TEXT NOT NULL DEFAULT 'counter',
  phase_override INTEGER,
  on_glp1 INTEGER NOT NULL DEFAULT 1,
  notify_enabled INTEGER NOT NULL DEFAULT 1,
  notify_morning TEXT NOT NULL DEFAULT '07:00',
  notify_evening TEXT NOT NULL DEFAULT '20:00',
  notify_mealplan_dow INTEGER NOT NULL DEFAULT 0,
  notify_mealplan_time TEXT NOT NULL DEFAULT '10:00',
  notify_weighin_dow INTEGER NOT NULL DEFAULT 5,
  notify_weighin_time TEXT NOT NULL DEFAULT '07:00',
  notify_trial_headsup INTEGER NOT NULL DEFAULT 1,
  timezone TEXT NOT NULL DEFAULT 'America/New_York',
  pin_hash TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS weigh_ins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL UNIQUE,
  lbs REAL NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS water_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  oz REAL NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_water_date ON water_logs(date);

CREATE TABLE IF NOT EXISTS protein_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  grams REAL NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_protein_date ON protein_logs(date);

CREATE TABLE IF NOT EXISTS workouts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  week_number INTEGER NOT NULL,
  phase INTEGER NOT NULL,
  day_of_week INTEGER NOT NULL,
  block TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  details TEXT NOT NULL DEFAULT '{}',
  is_test_day INTEGER NOT NULL DEFAULT 0,
  is_time_trial INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  completed INTEGER NOT NULL DEFAULT 0,
  skipped INTEGER NOT NULL DEFAULT 0,
  completed_at TEXT,
  UNIQUE (date, block)
);
CREATE INDEX IF NOT EXISTS idx_workouts_date ON workouts(date);
CREATE INDEX IF NOT EXISTS idx_workouts_week ON workouts(week_number);

CREATE TABLE IF NOT EXISTS workout_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workout_id INTEGER REFERENCES workouts(id) ON DELETE SET NULL,
  date TEXT NOT NULL,
  type TEXT NOT NULL,
  duration_min REAL,
  distance_mi REAL,
  intervals_completed INTEGER,
  incline_level TEXT,
  sets_json TEXT,
  plank_seconds TEXT,
  felt INTEGER,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_workout_logs_date ON workout_logs(date);

CREATE TABLE IF NOT EXISTS strength_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workout_id INTEGER REFERENCES workouts(id) ON DELETE SET NULL,
  date TEXT NOT NULL,
  exercise TEXT NOT NULL,
  set_index INTEGER NOT NULL,
  weight REAL,
  reps INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_strength_date ON strength_logs(date);

CREATE TABLE IF NOT EXISTS test_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('pushup', 'situp', 'run_trial')),
  value REAL NOT NULL,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_tests_type_date ON test_results(type, date);

CREATE TABLE IF NOT EXISTS meal_plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  week_start TEXT NOT NULL UNIQUE,
  plan_json TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'ai',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS grocery_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  week_start TEXT NOT NULL,
  section TEXT NOT NULL,
  item TEXT NOT NULL,
  quantity TEXT,
  checked INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_grocery_week ON grocery_items(week_start);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  label TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS notification_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  date TEXT NOT NULL,
  detail TEXT,
  sent_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (kind, date)
);
`);

export function getSettings() {
  return db.prepare('SELECT * FROM settings WHERE id = 1').get();
}

export function touchSettings() {
  db.prepare("UPDATE settings SET updated_at = datetime('now') WHERE id = 1").run();
}
