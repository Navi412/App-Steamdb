// Lista de "siguientes juegos por jugar" (tabla to_play_list, migración
// 009). Solo pertenencia: un juego está o no está en la lista.

function listGameIds(db) {
  return db
    .prepare('SELECT game_id FROM to_play_list ORDER BY added_at')
    .all()
    .map((row) => row.game_id);
}

function add(db, gameId) {
  db.prepare(
    `INSERT INTO to_play_list (game_id, added_at) VALUES (?, ?)
     ON CONFLICT(game_id) DO NOTHING`
  ).run(gameId, new Date().toISOString());
}

function remove(db, gameId) {
  db.prepare('DELETE FROM to_play_list WHERE game_id = ?').run(gameId);
}

module.exports = { listGameIds, add, remove };
