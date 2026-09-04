// Carátula propia del usuario, guardada como BLOB en `game_covers` (una
// fila por juego, ver migración 008). Se sube a mano desde la UI o se pega
// una URL que /api descarga; aquí solo se leen y escriben bytes.

function getCover(db, gameId) {
  const row = db
    .prepare('SELECT mime, bytes, updated_at FROM game_covers WHERE game_id = ?')
    .get(gameId);
  if (!row) return null;
  return { mime: row.mime, bytes: row.bytes, updatedAt: row.updated_at };
}

// `bytes` es un Buffer / Uint8Array. Devuelve el updated_at recién escrito.
function setCover(db, gameId, { mime, bytes }) {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO game_covers (game_id, mime, bytes, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(game_id) DO UPDATE SET
       mime = excluded.mime, bytes = excluded.bytes, updated_at = excluded.updated_at`
  ).run(gameId, mime, bytes, now);
  return now;
}

// Borrarla devuelve el juego a su carátula por defecto (arte de Steam/Xbox
// o hueco de reserva); no toca `games`.
function clearCover(db, gameId) {
  db.prepare('DELETE FROM game_covers WHERE game_id = ?').run(gameId);
}

module.exports = { getCover, setCover, clearCover };
