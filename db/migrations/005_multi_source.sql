-- Preparar el modelo para más plataformas que Steam (Epic, GOG, Xbox...).
--
-- Dos cambios:
--   1. El id externo de un juego deja de ser la columna `games.steam_appid`
--      y pasa a una tabla aparte `game_external_ids (source, external_id)`,
--      para no ir añadiendo una columna `*_appid` por cada tienda.
--   2. `steam_snapshots` se renombra a `playtime_snapshots` y gana una
--      columna `source`: el contador acumulado de horas es el mismo
--      concepto venga de donde venga.
--
-- SQLite no deja quitar una columna con UNIQUE ni con una CHECK que la
-- menciona, así que `games` se reconstruye entera. El runner de
-- migraciones desactiva las FK mientras corre esto (ver db/migrate.js).

CREATE TABLE game_external_ids (
  game_id      INTEGER NOT NULL REFERENCES games(id),
  source       TEXT NOT NULL CHECK (source IN ('steam', 'epic', 'gog', 'xbox')),
  external_id  TEXT NOT NULL,
  PRIMARY KEY (game_id, source),
  UNIQUE (source, external_id)
);

INSERT INTO game_external_ids (game_id, source, external_id)
  SELECT id, 'steam', CAST(steam_appid AS TEXT)
  FROM games
  WHERE steam_appid IS NOT NULL;

CREATE TABLE games_new (
  id                          INTEGER PRIMARY KEY,
  source                      TEXT NOT NULL CHECK (source IN ('steam', 'manual', 'epic', 'gog', 'xbox')),
  title                       TEXT NOT NULL,
  platform                    TEXT NOT NULL,
  icon_url                    TEXT,
  created_at                  TEXT NOT NULL,
  missing_since               TEXT,
  archived                    INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
  igdb_id                     INTEGER,
  igdb_main_minutes           INTEGER,
  igdb_completionist_minutes  INTEGER,
  igdb_updated_at             TEXT
);

INSERT INTO games_new (
  id, source, title, platform, icon_url, created_at, missing_since, archived,
  igdb_id, igdb_main_minutes, igdb_completionist_minutes, igdb_updated_at
)
  SELECT
    id, source, title, platform, icon_url, created_at, missing_since, archived,
    igdb_id, igdb_main_minutes, igdb_completionist_minutes, igdb_updated_at
  FROM games;

DROP TABLE games;
ALTER TABLE games_new RENAME TO games;

-- RENAME reconecta sola la FK de play_sessions.source_snapshot_id.
ALTER TABLE steam_snapshots RENAME TO playtime_snapshots;
ALTER TABLE playtime_snapshots ADD COLUMN source TEXT NOT NULL DEFAULT 'steam';

-- Búsquedas por (source, external_id) las cubre el UNIQUE de arriba.
DROP INDEX IF EXISTS idx_steam_snapshots_game;
CREATE INDEX IF NOT EXISTS idx_playtime_snapshots_game ON playtime_snapshots(game_id);
