// Id de un juego en una tienda externa (Steam appid, product id de GOG,
// título de Xbox...). Una fila por (juego, tienda). Sustituye a la vieja
// columna games.steam_appid para que añadir plataformas no sea añadir
// columnas.

function setExternalId(db, gameId, source, externalId) {
  db.prepare(
    `INSERT INTO game_external_ids (game_id, source, external_id)
     VALUES (?, ?, ?)
     ON CONFLICT(game_id, source) DO UPDATE SET external_id = excluded.external_id`
  ).run(gameId, source, String(externalId));
}

function findGameIdByExternalId(db, source, externalId) {
  const row = db
    .prepare('SELECT game_id FROM game_external_ids WHERE source = ? AND external_id = ?')
    .get(source, String(externalId));
  return row ? row.game_id : null;
}

// { steam: '620', xbox: '9NBLGGH4R315', ... } para un juego dado.
function externalIdsForGame(db, gameId) {
  const rows = db
    .prepare('SELECT source, external_id FROM game_external_ids WHERE game_id = ?')
    .all(gameId);
  return Object.fromEntries(rows.map((r) => [r.source, r.external_id]));
}

module.exports = { setExternalId, findGameIdByExternalId, externalIdsForGame };
