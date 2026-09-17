const { setExternalId, findGameIdByExternalId } = require('./external-ids');

function rowToGame(row) {
  return {
    id: row.id,
    source: row.source,
    steamAppId: row.steam_appid,
    title: row.title,
    platform: row.platform,
    iconUrl: row.icon_url,
    // Carátula subida por el usuario (tabla game_covers). Manda sobre el
    // arte de Steam/Xbox. El ?v= es para que el navegador la recargue al
    // cambiarla, ya que la ruta cachea de forma agresiva.
    coverUrl: row.cover_updated_at
      ? `/api/games/${row.id}/cover?v=${Date.parse(row.cover_updated_at)}`
      : null,
    // Encuadre de la carátula (object-position en %). Ver migración 011.
    coverPosX: row.cover_pos_x ?? 50,
    coverPosY: row.cover_pos_y ?? 50,
    inToPlay: Boolean(row.in_to_play),
    inPlayingNow: Boolean(row.in_playing_now),
    createdAt: row.created_at,
    missingSince: row.missing_since,
    archived: Boolean(row.archived),
    totalMinutes: row.total_minutes ?? 0,
    achievementsTotal: row.achievements_total ?? 0,
    achievementsUnlocked: row.achievements_unlocked ?? 0,
    igdbId: row.igdb_id,
    igdbMainMinutes: row.igdb_main_minutes,
    igdbCompletionistMinutes: row.igdb_completionist_minutes,
    igdbUpdatedAt: row.igdb_updated_at,
  };
}

// Subqueries en vez de LEFT JOIN: play_sessions y achievements son dos
// relaciones uno-a-muchos independientes, y unirlas en la misma query
// multiplicaría filas (cada sesión x cada logro) y falsearía ambos totales.
// steam_appid ya no es una columna de games (vive en game_external_ids),
// pero se sigue exponiendo con ese nombre porque la UI lo usa para armar
// la URL de la carátula.
const SELECT_WITH_STATS = `
  SELECT g.*,
    (SELECT external_id FROM game_external_ids e WHERE e.game_id = g.id AND e.source = 'steam') AS steam_appid,
    (SELECT updated_at FROM game_covers c WHERE c.game_id = g.id) AS cover_updated_at,
    (SELECT 1 FROM to_play_list t WHERE t.game_id = g.id) AS in_to_play,
    (SELECT 1 FROM playing_now p WHERE p.game_id = g.id) AS in_playing_now,
    (SELECT COALESCE(SUM(minutes), 0) FROM play_sessions s WHERE s.game_id = g.id) AS total_minutes,
    (SELECT COUNT(*) FROM achievements a WHERE a.game_id = g.id) AS achievements_total,
    (SELECT COUNT(*) FROM achievements a WHERE a.game_id = g.id AND a.achieved = 1) AS achievements_unlocked
  FROM games g
`;

function insertManualGame(db, { title, platform }) {
  const now = new Date().toISOString();
  const info = db
    .prepare(`INSERT INTO games (source, title, platform, created_at) VALUES ('manual', ?, ?, ?)`)
    .run(title, platform, now);
  return getGameById(db, info.lastInsertRowid);
}

function getGameById(db, id) {
  const row = db.prepare(`${SELECT_WITH_STATS} WHERE g.id = ?`).get(id);
  return row ? rowToGame(row) : null;
}

function getGameByExternalId(db, source, externalId) {
  const gameId = findGameIdByExternalId(db, source, externalId);
  return gameId ? getGameById(db, gameId) : null;
}

// Da de alta un juego de una plataforma (Steam, Xbox...) la primera vez que
// aparece en la biblioteca, o actualiza título/icono si ya existía (las
// tiendas los cambian de vez en cuando). No toca missing_since: la
// detección de ausencias vive en cada flujo de sync.
function upsertExternalGame(db, { source, externalId, title, iconUrl = null, platform }) {
  const now = new Date().toISOString();
  const existingId = findGameIdByExternalId(db, source, externalId);

  if (existingId) {
    db.prepare('UPDATE games SET title = ?, icon_url = ? WHERE id = ?').run(title, iconUrl, existingId);
    return getGameById(db, existingId);
  }

  const info = db
    .prepare(
      `INSERT INTO games (source, title, platform, icon_url, created_at) VALUES (?, ?, ?, ?, ?)`
    )
    .run(source, title, platform, iconUrl, now);
  setExternalId(db, info.lastInsertRowid, source, externalId);
  return getGameById(db, info.lastInsertRowid);
}

function listGames(db) {
  const rows = db.prepare(`${SELECT_WITH_STATS} ORDER BY g.title COLLATE NOCASE`).all();
  return rows.map(rowToGame);
}

function updateGame(db, id, changes) {
  const current = db.prepare('SELECT * FROM games WHERE id = ?').get(id);
  if (!current) return null;

  const title = changes.title !== undefined ? changes.title : current.title;
  const platform = changes.platform !== undefined ? changes.platform : current.platform;
  const archived = changes.archived !== undefined ? (changes.archived ? 1 : 0) : current.archived;
  const coverPosX = changes.coverPosX !== undefined ? changes.coverPosX : current.cover_pos_x;
  const coverPosY = changes.coverPosY !== undefined ? changes.coverPosY : current.cover_pos_y;

  db.prepare(
    'UPDATE games SET title = ?, platform = ?, archived = ?, cover_pos_x = ?, cover_pos_y = ? WHERE id = ?'
  ).run(title, platform, archived, coverPosX, coverPosY, id);

  return getGameById(db, id);
}

// Guarda el resultado de una búsqueda en IGDB (automática o corregida a
// mano). igdbId se pasa siempre explícitamente, ya que una corrección
// manual debe conservar el que ya había en vez de perderlo.
//
// coverUrl se trata distinto según el origen del juego:
//  - Steam: icon_url no lo usa la UI para nada más (la carátula sale de
//    steam_appid); aquí solo sirve como último recurso si library_600x900 y
//    header.jpg fallan o son el placeholder gris que sirve Steam con 200 OK
//    para juegos sin arte subido (visto con Battlefield 6). Por eso manda
//    siempre que haya coverUrl, aunque ya hubiera algo (el hash de icono de
//    Steam guardado por /sync, que además caduca con el tiempo).
//  - resto de orígenes (Xbox, GOG, Epic...): icon_url SÍ es la carátula que
//    pinta la UI, así que solo se rellena si está vacío (COALESCE) y nunca
//    se pisa una que ya funciona.
function setIgdbTimes(db, id, { igdbId, mainMinutes, completionistMinutes, coverUrl, source }) {
  const now = new Date().toISOString();
  const iconUrlExpr = source === 'steam' ? 'COALESCE(?, icon_url)' : 'COALESCE(icon_url, ?)';
  db.prepare(
    `UPDATE games SET igdb_id = ?, igdb_main_minutes = ?, igdb_completionist_minutes = ?, igdb_updated_at = ?,
       icon_url = ${iconUrlExpr} WHERE id = ?`
  ).run(igdbId ?? null, mainMinutes ?? null, completionistMinutes ?? null, now, coverUrl ?? null, id);
  return getGameById(db, id);
}

module.exports = {
  insertManualGame,
  getGameById,
  getGameByExternalId,
  upsertExternalGame,
  listGames,
  updateGame,
  setIgdbTimes,
};
