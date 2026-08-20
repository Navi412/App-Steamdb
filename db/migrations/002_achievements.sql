-- Logros de Steam. A diferencia de las horas jugadas, Steam sí da una
-- fecha exacta de desbloqueo por logro, así que no hace falta derivar
-- nada de un par de instantáneas: cada sync simplemente actualiza el
-- estado actual de cada logro.

CREATE TABLE achievements (
  id              INTEGER PRIMARY KEY,
  game_id         INTEGER NOT NULL REFERENCES games(id),
  api_name        TEXT NOT NULL,
  name            TEXT,
  description     TEXT,
  achieved        INTEGER NOT NULL DEFAULT 0 CHECK (achieved IN (0, 1)),
  unlocked_at     TEXT,
  last_synced_at  TEXT NOT NULL,
  UNIQUE (game_id, api_name)
);

CREATE INDEX idx_achievements_game ON achievements(game_id);
