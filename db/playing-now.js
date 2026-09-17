// Lista de "jugando ahora mismo" (tabla playing_now, migración 014). Mismo
// concepto que db/to-play.js pero independiente: solo pertenencia, un
// juego está o no está en la lista.

function listGameIds(db) {
  return db
    .prepare('SELECT game_id FROM playing_now ORDER BY added_at')
    .all()
    .map((row) => row.game_id);
}

function add(db, gameId) {
  db.prepare(
    `INSERT INTO playing_now (game_id, added_at) VALUES (?, ?)
     ON CONFLICT(game_id) DO NOTHING`
  ).run(gameId, new Date().toISOString());
}

function remove(db, gameId) {
  db.prepare('DELETE FROM playing_now WHERE game_id = ?').run(gameId);
}

module.exports = { listGameIds, add, remove };
