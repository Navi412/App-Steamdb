-- Esquema inicial. Ver docs/DESIGN.md para el razonamiento detrás de cada tabla.

CREATE TABLE games (
  id           INTEGER PRIMARY KEY,
  source       TEXT NOT NULL CHECK (source IN ('steam', 'manual')),
  steam_appid  INTEGER UNIQUE,
  title        TEXT NOT NULL,
  platform     TEXT NOT NULL,
  icon_url     TEXT,
  created_at   TEXT NOT NULL,
  missing_since TEXT,
  archived     INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
  CHECK ((source = 'steam' AND steam_appid IS NOT NULL) OR (source = 'manual' AND steam_appid IS NULL))
);

CREATE TABLE steam_snapshots (
  id                        INTEGER PRIMARY KEY,
  game_id                   INTEGER NOT NULL REFERENCES games(id),
  captured_at               TEXT NOT NULL,
  playtime_forever_minutes  INTEGER NOT NULL,
  playtime_2weeks_minutes   INTEGER,
  UNIQUE (game_id, captured_at)
);

CREATE INDEX idx_steam_snapshots_game ON steam_snapshots(game_id);

CREATE TABLE play_sessions (
  id                  INTEGER PRIMARY KEY,
  game_id             INTEGER NOT NULL REFERENCES games(id),
  minutes             INTEGER NOT NULL CHECK (minutes >= 0),
  started_at          TEXT,
  ended_at            TEXT,
  precision           TEXT NOT NULL CHECK (precision IN ('exact', 'approximate', 'derived')),
  origin              TEXT NOT NULL CHECK (origin IN ('steam_sync', 'manual')),
  source_snapshot_id  INTEGER REFERENCES steam_snapshots(id),
  note                TEXT,
  created_at          TEXT NOT NULL
);

CREATE INDEX idx_play_sessions_game ON play_sessions(game_id);

CREATE TABLE sync_anomalies (
  id           INTEGER PRIMARY KEY,
  game_id      INTEGER NOT NULL REFERENCES games(id),
  kind         TEXT NOT NULL CHECK (kind IN ('playtime_decreased', 'game_missing', 'game_reappeared')),
  detail       TEXT,
  occurred_at  TEXT NOT NULL
);

CREATE INDEX idx_sync_anomalies_game ON sync_anomalies(game_id);

CREATE TABLE sync_runs (
  id             INTEGER PRIMARY KEY,
  started_at     TEXT NOT NULL,
  finished_at    TEXT,
  status         TEXT NOT NULL CHECK (status IN ('running', 'ok', 'error')),
  games_synced   INTEGER,
  error_message  TEXT
);
