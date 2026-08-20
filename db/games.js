function rowToGame(row) {
  return {
    id: row.id,
    source: row.source,
    steamAppId: row.steam_appid,
    title: row.title,
    platform: row.platform,
    iconUrl: row.icon_url,
    createdAt: row.created_at,
    missingSince: row.missing_since,
    archived: Boolean(row.archived),
    totalMinutes: row.total_minutes ?? 0,
  };
}

const SELECT_WITH_TOTAL = `
  SELECT g.*, COALESCE(SUM(s.minutes), 0) AS total_minutes
  FROM games g
  LEFT JOIN play_sessions s ON s.game_id = g.id
`;

function insertManualGame(db, { title, platform }) {
  const now = new Date().toISOString();
  const info = db
    .prepare(`INSERT INTO games (source, title, platform, created_at) VALUES ('manual', ?, ?, ?)`)
    .run(title, platform, now);
  return getGameById(db, info.lastInsertRowid);
}

function getGameById(db, id) {
  const row = db.prepare(`${SELECT_WITH_TOTAL} WHERE g.id = ? GROUP BY g.id`).get(id);
  return row ? rowToGame(row) : null;
}

function listGames(db) {
  const rows = db.prepare(`${SELECT_WITH_TOTAL} GROUP BY g.id ORDER BY g.title COLLATE NOCASE`).all();
  return rows.map(rowToGame);
}

function updateGame(db, id, changes) {
  const current = db.prepare('SELECT * FROM games WHERE id = ?').get(id);
  if (!current) return null;

  const title = changes.title !== undefined ? changes.title : current.title;
  const platform = changes.platform !== undefined ? changes.platform : current.platform;
  const archived = changes.archived !== undefined ? (changes.archived ? 1 : 0) : current.archived;

  db.prepare('UPDATE games SET title = ?, platform = ?, archived = ? WHERE id = ?').run(
    title,
    platform,
    archived,
    id
  );

  return getGameById(db, id);
}

module.exports = { insertManualGame, getGameById, listGames, updateGame };
