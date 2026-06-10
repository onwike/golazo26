-- g26-db schema 0001 — sources, ingest, overrides, audit, and the core
-- football tables (venues, teams, matches, players, staff, images, ops).
CREATE TABLE IF NOT EXISTS sources (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('api','wiki','commons','manual','curated')),
  base_url TEXT,
  license TEXT,
  attribution_required INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS ingest_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id INTEGER REFERENCES sources(id),
  job TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  ok INTEGER,
  stats_json TEXT,
  error TEXT
);
CREATE TABLE IF NOT EXISTS discrepancies (
  id TEXT PRIMARY KEY,
  entity_type TEXT,
  entity_id TEXT,
  field TEXT,
  value_a TEXT,
  value_b TEXT,
  severity TEXT CHECK (severity IN ('blocker','warn')),
  status TEXT CHECK (status IN ('open','resolved','accepted')) DEFAULT 'open',
  resolution TEXT,
  source_a TEXT,
  source_b TEXT,
  created_at TEXT
);
CREATE TABLE IF NOT EXISTS overrides (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  field TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT NOT NULL,
  reason TEXT NOT NULL,
  actor TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  before_json TEXT,
  after_json TEXT,
  reason TEXT,
  ip TEXT
);
CREATE TABLE IF NOT EXISTS venues (
  id TEXT PRIMARY KEY,
  fifa_name TEXT NOT NULL UNIQUE,
  common_name TEXT NOT NULL,
  city TEXT NOT NULL,
  locality TEXT,
  country TEXT NOT NULL CHECK (country IN ('US','MX','CA')),
  tz TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS teams (
  name TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  group_letter TEXT NOT NULL CHECK (group_letter BETWEEN 'A' AND 'L'),
  iso TEXT NOT NULL,
  flag TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS matches (
  match_no INTEGER PRIMARY KEY CHECK (match_no BETWEEN 1 AND 104),
  stage TEXT NOT NULL CHECK (stage IN ('group','r32','r16','qf','sf','third','final')),
  group_letter TEXT,
  matchday INTEGER,
  kickoff_utc TEXT NOT NULL,
  venue_id TEXT NOT NULL REFERENCES venues(id),
  home_team TEXT REFERENCES teams(name),
  away_team TEXT REFERENCES teams(name),
  home_placeholder TEXT,
  away_placeholder TEXT,
  status TEXT NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled','in_play','finished_provisional','finished_confirmed','postponed')),
  home_score INTEGER,
  away_score INTEGER,
  score_source TEXT,
  last_checked_at TEXT,
  updated_at TEXT
);
CREATE TABLE IF NOT EXISTS match_source_raw (
  match_no INTEGER NOT NULL REFERENCES matches(match_no),
  source TEXT NOT NULL,
  raw_json TEXT,
  fetched_at TEXT,
  PRIMARY KEY (match_no, source)
);
CREATE TABLE IF NOT EXISTS standings_raw (
  group_letter TEXT PRIMARY KEY,
  fd_payload_json TEXT,
  fetched_at TEXT
);
CREATE TABLE IF NOT EXISTS broadcasts (
  match_no INTEGER NOT NULL REFERENCES matches(match_no),
  region TEXT NOT NULL DEFAULT 'US',
  us_english TEXT,
  us_spanish TEXT,
  source_url TEXT NOT NULL,
  verified_by TEXT NOT NULL,
  verified_at TEXT NOT NULL,
  notes TEXT,
  PRIMARY KEY (match_no, region)
);
CREATE TABLE IF NOT EXISTS players (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  team TEXT NOT NULL REFERENCES teams(name),
  squad_no INTEGER NOT NULL,
  pos TEXT NOT NULL CHECK (pos IN ('GK','DF','MF','FW')),
  name TEXT NOT NULL,
  wiki_title TEXT,
  captain INTEGER DEFAULT 0,
  dob TEXT,
  caps INTEGER,
  goals INTEGER,
  club TEXT,
  club_country TEXT,
  UNIQUE (team, squad_no)
);
CREATE TABLE IF NOT EXISTS staff (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  team TEXT NOT NULL REFERENCES teams(name),
  role TEXT NOT NULL,
  name TEXT NOT NULL,
  wiki_title TEXT,
  nationality_code TEXT
);
CREATE TABLE IF NOT EXISTS org_people (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org TEXT NOT NULL CHECK (org IN ('FIFA','USSF')),
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'confirmed',
  source_url TEXT NOT NULL,
  wikipedia_title TEXT,
  notes TEXT
);
CREATE TABLE IF NOT EXISTS images (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subject_type TEXT NOT NULL,
  subject_name TEXT NOT NULL,
  team TEXT,
  qid TEXT,
  status TEXT NOT NULL,
  commons_file TEXT,
  file_page TEXT,
  author TEXT,
  license TEXT,
  license_url TEXT,
  local_file TEXT,
  rejected_license TEXT
);
CREATE TABLE IF NOT EXISTS cron_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  ok INTEGER,
  changed_rows INTEGER,
  detail TEXT
);
CREATE TABLE IF NOT EXISTS error_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  scope TEXT NOT NULL,
  message TEXT NOT NULL,
  detail_json TEXT
);
CREATE TABLE IF NOT EXISTS quota_counters (
  day TEXT NOT NULL,
  metric TEXT NOT NULL,
  value INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, metric)
);
CREATE TABLE IF NOT EXISTS ops_flags (
  key TEXT PRIMARY KEY CHECK (key IN ('ai_halted','api_read_only','bake_paused')),
  value INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT
);
CREATE TABLE IF NOT EXISTS ai_budget (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  cap_usd REAL NOT NULL DEFAULT 15.0,
  alert_usd REAL NOT NULL DEFAULT 12.0,
  spent_usd REAL NOT NULL DEFAULT 0,
  halted INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO ops_flags (key, value, updated_at) VALUES
  ('ai_halted', 0, datetime('now')), ('api_read_only', 0, datetime('now')), ('bake_paused', 0, datetime('now'));
INSERT OR IGNORE INTO ai_budget (id) VALUES (1);
