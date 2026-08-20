function insertSnapshot(db, gameId, { capturedAt, playtimeForeverMinutes, playtime2WeeksMinutes = null }) {
  db.prepare(
    `INSERT INTO steam_snapshots (game_id, captured_at, playtime_forever_minutes, playtime_2weeks_minutes)
     VALUES (?, ?, ?, ?)`
  ).run(gameId, capturedAt, playtimeForeverMinutes, playtime2WeeksMinutes);
}

function getLatestSnapshot(db, gameId) {
  return db
    .prepare('SELECT * FROM steam_snapshots WHERE game_id = ? ORDER BY captured_at DESC LIMIT 1')
    .get(gameId);
}

module.exports = { insertSnapshot, getLatestSnapshot };
