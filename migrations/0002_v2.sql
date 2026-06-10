-- g26-db schema 0002 — signed-in users, their match predictions, the AI
-- prediction league (models competing as contestants), and editorial stories.
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  clerk_user_id TEXT NOT NULL UNIQUE,
  email TEXT,
  full_name TEXT,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user','admin')),
  locked INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  synced_at TEXT,
  deleted_at TEXT
);
CREATE TABLE IF NOT EXISTS webhook_events (
  svix_id TEXT PRIMARY KEY,
  event_type TEXT,
  received_at TEXT NOT NULL DEFAULT (datetime('now')),
  processed INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS predictions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  clerk_user_id TEXT NOT NULL,
  match_no INTEGER NOT NULL REFERENCES matches(match_no),
  home INTEGER NOT NULL CHECK (home BETWEEN 0 AND 99),
  away INTEGER NOT NULL CHECK (away BETWEEN 0 AND 99),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  voided INTEGER NOT NULL DEFAULT 0,
  voided_reason TEXT,
  UNIQUE (clerk_user_id, match_no)
);
CREATE INDEX IF NOT EXISTS idx_predictions_match ON predictions(match_no);
CREATE TABLE IF NOT EXISTS ai_predictions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL CHECK (provider IN ('claude','gpt','gemini','grok')),
  match_no INTEGER NOT NULL REFERENCES matches(match_no),
  home INTEGER NOT NULL,
  away INTEGER NOT NULL,
  rationale TEXT,
  model TEXT,
  predicted_at TEXT NOT NULL DEFAULT (datetime('now')),
  cost_usd REAL,
  UNIQUE (provider, match_no)
);
CREATE TABLE IF NOT EXISTS stories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK (kind IN ('team_outlook','match_preview','match_recap')),
  subject_id TEXT NOT NULL,
  locale TEXT NOT NULL DEFAULT 'en',
  body_md TEXT,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','in_review','approved','published','unpublished')),
  cost_usd REAL,
  approved_by TEXT,
  published_at TEXT,
  UNIQUE (kind, subject_id, locale)
);
CREATE TABLE IF NOT EXISTS leaderboard_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  computed_at TEXT NOT NULL DEFAULT (datetime('now')),
  scope TEXT NOT NULL DEFAULT 'humans' CHECK (scope IN ('humans','ai')),
  payload_json TEXT NOT NULL
);
