function startRun(db) {
  const info = db.prepare(`INSERT INTO sync_runs (started_at, status) VALUES (?, 'running')`).run(
    new Date().toISOString()
  );
  return info.lastInsertRowid;
}

function finishRun(db, id, { gamesSynced }) {
  db.prepare(`UPDATE sync_runs SET finished_at = ?, status = 'ok', games_synced = ? WHERE id = ?`).run(
    new Date().toISOString(),
    gamesSynced,
    id
  );
}

function failRun(db, id, errorMessage) {
  db.prepare(`UPDATE sync_runs SET finished_at = ?, status = 'error', error_message = ? WHERE id = ?`).run(
    new Date().toISOString(),
    errorMessage,
    id
  );
}

module.exports = { startRun, finishRun, failRun };
