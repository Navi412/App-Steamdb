-- "Lista de siguientes": los juegos que el usuario aparta para jugar
-- próximamente, arrastrándolos a la zona de la izquierda. Una fila por
-- juego (el id de la fila principal, tal como aparece en la lista
-- agrupada). Se ordena por cuándo se añadió.

CREATE TABLE to_play_list (
  game_id   INTEGER PRIMARY KEY REFERENCES games(id),
  added_at  TEXT NOT NULL
);
