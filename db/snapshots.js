// Instantáneas del contador acumulado de horas de un juego. El dato crudo
// tal cual lo da la plataforma (Steam, Xbox...); nadie fuera de los
// runners de sync y de /db debería leerlo para calcular estadísticas.
// `playtime_2weeks_minutes` es un extra que solo trae Steam.

function rowToSnapshot(row) {
  return {
    id: row.id,
    gameId: row.game_id,
    source: row.source,
    capturedAt: row.captured_at,
    playtimeForeverMinutes: row.playtime_forever_minutes,
    playtime2WeeksMinutes: row.playtime_2weeks_minutes,
  };
}

function insertSnapshot(
  db,
  gameId,
  { source, capturedAt, playtimeForeverMinutes, playtime2WeeksMinutes = null }
) {
  const info = db
    .prepare(
      `INSERT INTO playtime_snapshots (game_id, source, captured_at, playtime_forever_minutes, playtime_2weeks_minutes)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(gameId, source, capturedAt, playtimeForeverMinutes, playtime2WeeksMinutes);

  return {
    id: info.lastInsertRowid,
    gameId,
    source,
    capturedAt,
    playtimeForeverMinutes,
    playtime2WeeksMinutes,
  };
}

// Un juego pertenece a una sola plataforma (games.source), así que basta
// con game_id para encontrar su última instantánea.
function getLatestSnapshot(db, gameId) {
  const row = db
    .prepare('SELECT * FROM playtime_snapshots WHERE game_id = ? ORDER BY captured_at DESC LIMIT 1')
    .get(gameId);
  return row ? rowToSnapshot(row) : null;
}

module.exports = { insertSnapshot, getLatestSnapshot };
