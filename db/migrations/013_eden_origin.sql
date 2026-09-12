-- Permitir juegos de Eden (emulador de Nintendo Switch) como fuente.
-- A diferencia de Xbox/Epic/GOG, esta plataforma no estaba anticipada en
-- el CHECK de `games.source` ni de `game_external_ids.source` (migración
-- 005), así que hay que reconstruir esas dos tablas además de
-- `play_sessions` (el patrón de siempre: SQLite no deja modificar una
-- CHECK, y el runner de migraciones corre esto con las FK desactivadas).

CREATE TABLE games_new (
  id                          INTEGER PRIMARY KEY,
  source                      TEXT NOT NULL CHECK (source IN ('steam', 'manual', 'epic', 'gog', 'xbox', 'eden')),
  title                       TEXT NOT NULL,
  platform                    TEXT NOT NULL,
  icon_url                    TEXT,
  created_at                  TEXT NOT NULL,
  missing_since               TEXT,
  archived                    INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
  igdb_id                     INTEGER,
  igdb_main_minutes           INTEGER,
  igdb_completionist_minutes  INTEGER,
  igdb_updated_at             TEXT,
  cover_pos_x                 INTEGER NOT NULL DEFAULT 50,
  cover_pos_y                 INTEGER NOT NULL DEFAULT 50
);

INSERT INTO games_new (
  id, source, title, platform, icon_url, created_at, missing_since, archived,
  igdb_id, igdb_main_minutes, igdb_completionist_minutes, igdb_updated_at,
  cover_pos_x, cover_pos_y
)
  SELECT
    id, source, title, platform, icon_url, created_at, missing_since, archived,
    igdb_id, igdb_main_minutes, igdb_completionist_minutes, igdb_updated_at,
    cover_pos_x, cover_pos_y
  FROM games;

DROP TABLE games;
ALTER TABLE games_new RENAME TO games;

CREATE TABLE game_external_ids_new (
  game_id      INTEGER NOT NULL REFERENCES games(id),
  source       TEXT NOT NULL CHECK (source IN ('steam', 'epic', 'gog', 'xbox', 'eden')),
  external_id  TEXT NOT NULL,
  PRIMARY KEY (game_id, source),
  UNIQUE (source, external_id)
);

INSERT INTO game_external_ids_new (game_id, source, external_id)
  SELECT game_id, source, external_id FROM game_external_ids;

DROP TABLE game_external_ids;
ALTER TABLE game_external_ids_new RENAME TO game_external_ids;

CREATE TABLE play_sessions_new (
  id                  INTEGER PRIMARY KEY,
  game_id             INTEGER NOT NULL REFERENCES games(id),
  minutes             INTEGER NOT NULL CHECK (minutes >= 0),
  started_at          TEXT,
  ended_at            TEXT,
  precision           TEXT NOT NULL CHECK (precision IN ('exact', 'approximate', 'derived')),
  origin              TEXT NOT NULL CHECK (origin IN ('steam_sync', 'xbox_sync', 'epic_sync', 'gog_sync', 'eden_sync', 'manual')),
  source_snapshot_id  INTEGER REFERENCES playtime_snapshots(id),
  note                TEXT,
  created_at          TEXT NOT NULL
);

INSERT INTO play_sessions_new
  (id, game_id, minutes, started_at, ended_at, precision, origin, source_snapshot_id, note, created_at)
  SELECT id, game_id, minutes, started_at, ended_at, precision, origin, source_snapshot_id, note, created_at
  FROM play_sessions;

DROP TABLE play_sessions;
ALTER TABLE play_sessions_new RENAME TO play_sessions;

CREATE INDEX IF NOT EXISTS idx_play_sessions_game ON play_sessions(game_id);
