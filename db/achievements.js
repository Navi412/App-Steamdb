function rowToAchievement(row) {
  return {
    id: row.id,
    gameId: row.game_id,
    apiName: row.api_name,
    name: row.name,
    description: row.description,
    achieved: Boolean(row.achieved),
    unlockedAt: row.unlocked_at,
    lastSyncedAt: row.last_synced_at,
  };
}

function upsertAchievement(db, gameId, { apiName, name, description, achieved, unlockedAt }) {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO achievements (game_id, api_name, name, description, achieved, unlocked_at, last_synced_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(game_id, api_name) DO UPDATE SET
       name = excluded.name,
       description = excluded.description,
       achieved = excluded.achieved,
       unlocked_at = excluded.unlocked_at,
       last_synced_at = excluded.last_synced_at`
  ).run(gameId, apiName, name ?? null, description ?? null, achieved ? 1 : 0, unlockedAt, now);
}

function listAchievementsForGame(db, gameId) {
  return db
    .prepare('SELECT * FROM achievements WHERE game_id = ? ORDER BY achieved DESC, unlocked_at DESC')
    .all(gameId)
    .map(rowToAchievement);
}

module.exports = { upsertAchievement, listAchievementsForGame };
