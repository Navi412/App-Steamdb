-- Permitir sesiones derivadas de la sync de Xbox. SQLite no deja modificar
-- una CHECK, así que se reconstruye play_sessions (el runner de migraciones
-- corre esto con las FK desactivadas).

CREATE TABLE play_sessions_new (
  id                  INTEGER PRIMARY KEY,
  game_id             INTEGER NOT NULL REFERENCES games(id),
  minutes             INTEGER NOT NULL CHECK (minutes >= 0),
  started_at          TEXT,
  ended_at            TEXT,
  precision           TEXT NOT NULL CHECK (precision IN ('exact', 'approximate', 'derived')),
  origin              TEXT NOT NULL CHECK (origin IN ('steam_sync', 'xbox_sync', 'manual')),
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
