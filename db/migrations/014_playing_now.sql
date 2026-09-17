-- "Jugando ahora": los juegos que el usuario tiene en marcha en este
-- momento, arrastrándolos a la zona de la derecha (misma idea que
-- to_play_list, ver migración 009, pero es una lista independiente: un
-- juego puede estar en las dos, en ninguna, o solo en una).

CREATE TABLE playing_now (
  game_id   INTEGER PRIMARY KEY REFERENCES games(id),
  added_at  TEXT NOT NULL
);
