function insertAnomaly(db, gameId, { kind, detail }) {
  db.prepare('INSERT INTO sync_anomalies (game_id, kind, detail, occurred_at) VALUES (?, ?, ?, ?)').run(
    gameId,
    kind,
    detail,
    new Date().toISOString()
  );
}

function listAnomaliesForGame(db, gameId) {
  return db.prepare('SELECT * FROM sync_anomalies WHERE game_id = ? ORDER BY occurred_at DESC').all(gameId);
}

module.exports = { insertAnomaly, listAnomaliesForGame };
