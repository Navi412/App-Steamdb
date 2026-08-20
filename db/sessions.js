function rowToSession(row) {
  return {
    id: row.id,
    gameId: row.game_id,
    minutes: row.minutes,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    precision: row.precision,
    origin: row.origin,
    sourceSnapshotId: row.source_snapshot_id,
    note: row.note,
    createdAt: row.created_at,
  };
}

function insertSession(db, gameId, draft) {
  const now = new Date().toISOString();
  const info = db
    .prepare(
      `INSERT INTO play_sessions (game_id, minutes, started_at, ended_at, precision, origin, note, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(gameId, draft.minutes, draft.startedAt, draft.endedAt, draft.precision, draft.origin, draft.note, now);

  return rowToSession(db.prepare('SELECT * FROM play_sessions WHERE id = ?').get(info.lastInsertRowid));
}

function listSessionsForGame(db, gameId) {
  return db
    .prepare('SELECT * FROM play_sessions WHERE game_id = ? ORDER BY created_at DESC')
    .all(gameId)
    .map(rowToSession);
}

module.exports = { insertSession, listSessionsForGame };
