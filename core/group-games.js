// Unificación multiplataforma en la capa de lectura. Cada runner de sync
// (Steam, Xbox, Epic) da de alta su propia fila en `games`, así que un mismo
// juego que está en dos tiendas son dos filas. Aquí se agrupan por título
// normalizado para mostrarlo una sola vez, con las horas sumadas y la
// etiqueta de cada plataforma.
//
// No es una fusión en base de datos: los contadores acumulados de cada
// plataforma (playtime_snapshots) no son comparables entre sí y deben
// seguir separados para que core/derive-session funcione. Esto es solo
// presentación y agregados. Función pura: filas planas dentro y fuera.

// "Call of Duty®" -> "call of duty", "Overcooked! 2" -> "overcooked 2",
// "Celeste" y "CELESTE" -> "celeste".
function groupKey(title) {
  return String(title)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // diacríticos combinados
    .toLowerCase()
    .replace(/[®™©]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function firstDefined(rows, field) {
  for (const row of rows) {
    if (row[field] !== null && row[field] !== undefined) return row[field];
  }
  return null;
}

function mergeGroup(rows) {
  // Fila principal: la más jugada; desempate por id menor. Es la que aporta
  // source/createdAt y el id que usan los enlaces a detalle.
  const primary = [...rows].sort(
    (a, b) => (b.totalMinutes ?? 0) - (a.totalMinutes ?? 0) || a.id - b.id
  )[0];

  // Una entrada por plataforma distinta (la principal primero), con el id de
  // la fila que la representa — así la UI puede enlazar al detalle de cada
  // tienda. platforms/platformIds van alineados por índice.
  const ordered = [primary, ...rows.filter((r) => r !== primary)];
  const platformEntries = [];
  for (const row of ordered) {
    if (row.platform && !platformEntries.some((e) => e.platform === row.platform)) {
      platformEntries.push({ platform: row.platform, id: row.id });
    }
  }
  const platforms = platformEntries.map((e) => e.platform);
  const platformIds = platformEntries.map((e) => e.id);

  // La carátula vertical de coverHtml necesita steamAppId; si el grupo tiene
  // una fila de Steam, su icono manda sobre el de Xbox.
  const steamRow = rows.find((r) => r.steamAppId) || null;
  const igdbRow = rows.find((r) => r.igdbMainMinutes != null) || null;

  const sum = (field) => rows.reduce((acc, r) => acc + (r[field] ?? 0), 0);

  return {
    ...primary,
    id: primary.id,
    ids: rows.map((r) => r.id),
    platforms,
    platformIds,
    platform: platforms[0] ?? primary.platform,
    totalMinutes: sum('totalMinutes'),
    achievementsTotal: sum('achievementsTotal'),
    achievementsUnlocked: sum('achievementsUnlocked'),
    steamAppId: steamRow ? steamRow.steamAppId : null,
    iconUrl: steamRow ? steamRow.iconUrl : firstDefined(rows, 'iconUrl'),
    igdbId: igdbRow ? igdbRow.igdbId : firstDefined(rows, 'igdbId'),
    igdbMainMinutes: igdbRow ? igdbRow.igdbMainMinutes : null,
    igdbCompletionistMinutes: igdbRow ? igdbRow.igdbCompletionistMinutes : null,
    igdbUpdatedAt: igdbRow ? igdbRow.igdbUpdatedAt : firstDefined(rows, 'igdbUpdatedAt'),
    missingSince: firstDefined(rows, 'missingSince'),
    archived: rows.every((r) => r.archived),
    createdAt: rows.reduce(
      (min, r) => (r.createdAt && (!min || r.createdAt < min) ? r.createdAt : min),
      primary.createdAt
    ),
  };
}

// Colapsa las filas cuyo groupKey(title) coincide. El orden de salida sigue
// al de entrada (por la primera fila de cada grupo); la UI reordena después.
function groupGames(games) {
  const groups = new Map();
  for (const game of games) {
    const key = groupKey(game.title);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(game);
  }
  return [...groups.values()].map(mergeGroup);
}

module.exports = { groupGames, groupKey };
