function rowToSnapshot(row) {
  return {
    id: row.id,
    gameId: row.game_id,
    capturedAt: row.captured_at,
    playtimeForeverMinutes: row.playtime_forever_minutes,
    playtime2WeeksMinutes: row.playtime_2weeks_minutes,
  };
}

function insertSnapshot(db, gameId, { capturedAt, playtimeForeverMinutes, playtime2WeeksMinutes = null }) {
  const info = db
    .prepare(
      `INSERT INTO steam_snapshots (game_id, captured_at, playtime_forever_minutes, playtime_2weeks_minutes)
       VALUES (?, ?, ?, ?)`
    )
    .run(gameId, capturedAt, playtimeForeverMinutes, playtime2WeeksMinutes);

  return { id: info.lastInsertRowid, gameId, capturedAt, playtimeForeverMinutes, playtime2WeeksMinutes };
}

function getLatestSnapshot(db, gameId) {
  const row = db
    .prepare('SELECT * FROM steam_snapshots WHERE game_id = ? ORDER BY captured_at DESC LIMIT 1')
    .get(gameId);
  return row ? rowToSnapshot(row) : null;
}

module.exports = { insertSnapshot, getLatestSnapshot };
