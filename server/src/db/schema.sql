-- Dynasty Helper schema. Applied idempotently by migrate.js.
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS leagues (
  league_id           TEXT PRIMARY KEY,
  name                TEXT,
  season              TEXT,
  season_type         TEXT,
  sport               TEXT,
  status              TEXT,
  total_rosters       INTEGER,
  roster_positions    TEXT,       -- JSON array
  scoring_settings    TEXT,       -- JSON object
  league_settings     TEXT,       -- JSON object
  previous_league_id  TEXT,
  draft_id            TEXT,
  avatar              TEXT,
  format_key          TEXT,
  fetched_at          TEXT
);

CREATE TABLE IF NOT EXISTS users (
  league_id     TEXT NOT NULL,
  user_id       TEXT NOT NULL,
  username      TEXT,
  display_name  TEXT,
  team_name     TEXT,
  avatar        TEXT,
  fetched_at    TEXT,
  PRIMARY KEY (league_id, user_id)
);

CREATE TABLE IF NOT EXISTS rosters (
  league_id      TEXT NOT NULL,
  roster_id      INTEGER NOT NULL,
  owner_id       TEXT,
  co_owners      TEXT,   -- JSON array
  players        TEXT,   -- JSON array of sleeper player ids
  starters       TEXT,   -- JSON array
  reserve        TEXT,   -- JSON array
  taxi           TEXT,   -- JSON array
  wins           INTEGER DEFAULT 0,
  losses         INTEGER DEFAULT 0,
  ties           INTEGER DEFAULT 0,
  fpts           REAL DEFAULT 0,
  fpts_against   REAL DEFAULT 0,
  settings       TEXT,   -- JSON object
  fetched_at     TEXT,
  PRIMARY KEY (league_id, roster_id)
);

CREATE TABLE IF NOT EXISTS players (
  player_id         TEXT PRIMARY KEY,
  first_name        TEXT,
  last_name         TEXT,
  full_name         TEXT,
  search_name       TEXT,
  position          TEXT,
  fantasy_positions TEXT,   -- JSON array
  team              TEXT,
  birth_date        TEXT,
  age               REAL,
  years_exp         INTEGER,
  status            TEXT,
  injury_status     TEXT,
  number            INTEGER,
  college           TEXT,
  updated_at        TEXT
);
CREATE INDEX IF NOT EXISTS idx_players_search ON players(search_name);
CREATE INDEX IF NOT EXISTS idx_players_pos    ON players(position);

CREATE TABLE IF NOT EXISTS traded_picks (
  league_id          TEXT NOT NULL,
  season             TEXT NOT NULL,
  round              INTEGER NOT NULL,
  original_roster_id INTEGER NOT NULL,   -- whose pick it originally is
  current_owner_id   INTEGER,            -- who holds it now
  previous_owner_id  INTEGER,
  fetched_at         TEXT,
  PRIMARY KEY (league_id, season, round, original_roster_id)
);

CREATE TABLE IF NOT EXISTS drafts (
  draft_id          TEXT PRIMARY KEY,
  league_id         TEXT,
  season            TEXT,
  rounds            INTEGER,
  type              TEXT,
  status            TEXT,
  slot_to_roster_id TEXT,   -- JSON object
  draft_order       TEXT,   -- JSON object
  settings          TEXT,   -- JSON object
  start_time        INTEGER,
  fetched_at        TEXT
);

CREATE TABLE IF NOT EXISTS transactions (
  transaction_id  TEXT PRIMARY KEY,
  league_id       TEXT NOT NULL,
  type            TEXT,
  status          TEXT,
  week            INTEGER,
  season          TEXT,
  created         INTEGER,
  roster_ids      TEXT,   -- JSON array
  adds            TEXT,   -- JSON object player_id -> roster_id
  drops           TEXT,   -- JSON object player_id -> roster_id
  draft_picks     TEXT,   -- JSON array
  waiver_budget   TEXT,   -- JSON array
  creator         TEXT,
  consenter_ids   TEXT,   -- JSON array
  fetched_at      TEXT
);
CREATE INDEX IF NOT EXISTS idx_tx_league_type ON transactions(league_id, type);
CREATE INDEX IF NOT EXISTS idx_tx_created     ON transactions(created);

-- One row per player per day per league format. Drives current values and history.
CREATE TABLE IF NOT EXISTS value_snapshots (
  captured_on   TEXT NOT NULL,     -- YYYY-MM-DD
  source        TEXT NOT NULL,     -- 'fantasycalc'
  format_key    TEXT NOT NULL,     -- dyn-sf-12t-1ppr
  player_key    TEXT NOT NULL,     -- sleeper:<id> | fc:<id>
  sleeper_id    TEXT,
  source_id     TEXT,
  name          TEXT,
  position      TEXT,
  team          TEXT,
  value         REAL NOT NULL,
  overall_rank  INTEGER,
  position_rank INTEGER,
  trend_30d     REAL,
  redraft_value REAL,
  age           REAL,
  PRIMARY KEY (captured_on, source, format_key, player_key)
);
CREATE INDEX IF NOT EXISTS idx_vs_lookup ON value_snapshots(format_key, captured_on, value DESC);
CREATE INDEX IF NOT EXISTS idx_vs_player ON value_snapshots(player_key, captured_on);

-- Draft pick values as published by the value source (position 'PI' entries).
CREATE TABLE IF NOT EXISTS pick_values (
  captured_on TEXT NOT NULL,
  source      TEXT NOT NULL,
  format_key  TEXT NOT NULL,
  label       TEXT NOT NULL,      -- raw label e.g. "2027 Mid 1st"
  season      TEXT,
  round       INTEGER,
  slot_bucket TEXT,               -- early | mid | late | generic
  value       REAL NOT NULL,
  PRIMARY KEY (captured_on, source, format_key, label)
);

CREATE TABLE IF NOT EXISTS value_overrides (
  player_key TEXT PRIMARY KEY,
  sleeper_id TEXT,
  name       TEXT,
  pct        REAL NOT NULL,       -- percent delta, e.g. +10 or -15
  note       TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS watchlist (
  league_id    TEXT NOT NULL,
  sleeper_id   TEXT NOT NULL,
  note         TEXT,
  target_value REAL,
  created_at   TEXT,
  PRIMARY KEY (league_id, sleeper_id)
);

CREATE TABLE IF NOT EXISTS fetch_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  source      TEXT,
  url         TEXT,
  ok          INTEGER,
  status      INTEGER,
  error       TEXT,
  duration_ms INTEGER,
  bytes       INTEGER,
  fetched_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_fetchlog_time ON fetch_log(fetched_at DESC);

CREATE TABLE IF NOT EXISTS kv (
  key   TEXT PRIMARY KEY,
  value TEXT
);
