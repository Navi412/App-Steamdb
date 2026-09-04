-- Carátula propia del usuario para un juego: una imagen que sube a mano
-- (o pega por URL y el servidor descarga una vez). Tiene prioridad sobre
-- el arte de Steam/Xbox y sobre icon_url; al borrarla, el juego vuelve a
-- mostrar su carátula por defecto.
--
-- Vive en una tabla aparte para no arrastrar el BLOB en cada `SELECT g.*`
-- de la lista: el hot path solo mira `updated_at` con una subquery.

CREATE TABLE game_covers (
  game_id     INTEGER PRIMARY KEY REFERENCES games(id),
  mime        TEXT NOT NULL,
  bytes       BLOB NOT NULL,
  updated_at  TEXT NOT NULL
);
