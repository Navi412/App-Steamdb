// Cliente de GOG Galaxy. A diferencia de Steam/Xbox/Epic no habla por red:
// GOG no tiene API de horas jugadas, pero el cliente de escritorio (GOG
// Galaxy) guarda todo en una base SQLite local —biblioteca, minutos
// jugados, última vez jugado y logros— y de ahí lo saca este módulo.
//
// Galaxy también recopila datos de las plataformas que le conectes (Steam,
// Epic, Xbox...). Aquí se ignora todo eso: solo se leen las claves
// `gog_*`, para no duplicar lo que ya traen los otros syncs.
//
// No sabe nada de nuestra SQLite ni de qué juego de la base se trata:
// devuelve objetos planos que /db y /core entienden.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

// Ruta por defecto en Windows. `ProgramData` es fija; Galaxy no deja
// elegir dónde va su base. Se puede forzar otra con GOG_GALAXY_DB.
const DEFAULT_DB_PATH =
  process.env.GOG_GALAXY_DB ||
  path.join(
    process.env.ProgramData || 'C:\\ProgramData',
    'GOG.com',
    'Galaxy',
    'storage',
    'galaxy-2.0.db'
  );

// Extras que GOG mete en la biblioteca junto a los juegos (códigos de
// descuento de la tienda de CD Projekt, sobre todo). No son jugables; se
// descartan por el título y se informa de cuáles.
const NON_GAME_TITLE = /discount code/i;

// Galaxy guarda las fechas como 'YYYY-MM-DD HH:MM:SS' sin zona. Se tratan
// como UTC para dar un ISO estable (igual que hacen los otros syncs); el
// pequeño desfase de zona es irrelevante para agrupar sesiones por día.
function toIso(galaxyDate) {
  if (!galaxyDate) return null;
  const d = new Date(`${String(galaxyDate).trim().replace(' ', 'T')}Z`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function parseTitle(pieceValue) {
  if (!pieceValue) return null;
  try {
    const parsed = JSON.parse(pieceValue);
    return typeof parsed?.title === 'string' ? parsed.title : null;
  } catch {
    return null;
  }
}

// Copia la base (y su -wal/-shm si los hay) a un directorio temporal antes
// de leerla: Galaxy suele estar abierto y con la base bloqueada, y así
// además se ven los últimos cambios sin escribir una sola línea en la
// original.
function withGalaxyCopy(dbPath, fn) {
  if (!fs.existsSync(dbPath)) {
    throw new Error(
      `no se encontró la base de GOG Galaxy en ${dbPath}. ` +
        '¿Está instalado GOG Galaxy? Si la tienes en otra ruta, define GOG_GALAXY_DB en el .env.'
    );
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'steamdb-gog-'));
  try {
    const copy = path.join(tmpDir, 'galaxy.db');
    fs.copyFileSync(dbPath, copy);
    for (const suffix of ['-wal', '-shm']) {
      if (fs.existsSync(dbPath + suffix)) fs.copyFileSync(dbPath + suffix, copy + suffix);
    }
    const db = new DatabaseSync(copy);
    try {
      return fn(db);
    } finally {
      db.close();
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

function rows(db, sql, params = []) {
  const stmt = db.prepare(sql);
  return stmt.all(...params);
}

// userId con más entradas en la biblioteca: Galaxy admite varias cuentas
// en la misma máquina, pero lo normal es una. Se puede fijar con
// GOG_GALAXY_USER_ID.
function resolveUserId(db) {
  if (process.env.GOG_GALAXY_USER_ID) return String(process.env.GOG_GALAXY_USER_ID);
  const row = rows(
    db,
    `SELECT CAST(userId AS TEXT) AS uid, COUNT(*) AS n
       FROM LibraryReleases GROUP BY userId ORDER BY n DESC LIMIT 1`
  )[0];
  return row ? row.uid : null;
}

// Lee la biblioteca de GOG de la base de Galaxy y la devuelve ya masticada:
//   { games: [{ gogId, releaseKey, title, minutes, lastPlayed, achievements }], skipped: [...] }
// achievements: [{ apiName, name, description, achieved, unlockedAt }]
function readGogLibrary({ dbPath = DEFAULT_DB_PATH } = {}) {
  return withGalaxyCopy(dbPath, (db) => {
    const userId = resolveUserId(db);
    if (!userId) return { games: [], skipped: [] };

    const owned = rows(
      db,
      `SELECT lr.releaseKey AS releaseKey,
              COALESCE(
                (SELECT gp.value FROM GamePieces gp
                   WHERE gp.releaseKey = lr.releaseKey
                     AND gp.gamePieceTypeId = (SELECT id FROM GamePieceTypes WHERE type = 'title')
                   LIMIT 1),
                (SELECT gp.value FROM GamePieces gp
                   WHERE gp.releaseKey = lr.releaseKey
                     AND gp.gamePieceTypeId = (SELECT id FROM GamePieceTypes WHERE type = 'originalTitle')
                   LIMIT 1)
              ) AS titleJson
         FROM LibraryReleases lr
        WHERE lr.releaseKey LIKE 'gog\\_%' ESCAPE '\\'
          AND CAST(lr.userId AS TEXT) = ?`,
      [userId]
    );

    const minutesByKey = new Map(
      rows(
        db,
        `SELECT releaseKey, minutesInGame FROM GameTimes
          WHERE releaseKey LIKE 'gog\\_%' ESCAPE '\\' AND CAST(userId AS TEXT) = ?`,
        [userId]
      ).map((r) => [r.releaseKey, Number(r.minutesInGame) || 0])
    );

    const lastPlayedByKey = new Map(
      rows(
        db,
        `SELECT gameReleaseKey, lastPlayedDate FROM LastPlayedDates
          WHERE gameReleaseKey LIKE 'gog\\_%' ESCAPE '\\' AND CAST(userId AS TEXT) = ?`,
        [userId]
      ).map((r) => [r.gameReleaseKey, toIso(r.lastPlayedDate)])
    );

    const achievementsByKey = new Map();
    for (const r of rows(
      db,
      `SELECT ua.gameReleaseKey AS releaseKey, ua.apikey AS apiName,
              ua.isUnlocked AS isUnlocked, ua.unlockTime AS unlockTime,
              la.name AS name, la.description AS description
         FROM UserAchievements ua
         LEFT JOIN LocalizedAchievements la
           ON la.gameReleaseKey = ua.gameReleaseKey AND la.apikey = ua.apikey
        WHERE ua.gameReleaseKey LIKE 'gog\\_%' ESCAPE '\\'
          AND CAST(ua.userId AS TEXT) = ?
        GROUP BY ua.gameReleaseKey, ua.apikey`,
      [userId]
    )) {
      const achieved = Number(r.isUnlocked) === 1;
      if (!achievementsByKey.has(r.releaseKey)) achievementsByKey.set(r.releaseKey, []);
      achievementsByKey.get(r.releaseKey).push({
        apiName: r.apiName,
        name: r.name ?? null,
        description: r.description ?? null,
        achieved,
        unlockedAt: achieved ? toIso(r.unlockTime) : null,
      });
    }

    const games = [];
    const skipped = [];
    // Juegos distintos con el mismo título en GOG (p. ej. dos claves de la
    // misma edición): se funden en uno, sumando horas y logros, para no
    // mostrarlo duplicado.
    const byTitle = new Map();

    for (const row of owned) {
      const title = parseTitle(row.titleJson);
      if (!title) {
        skipped.push({ releaseKey: row.releaseKey, title: null });
        continue;
      }
      if (NON_GAME_TITLE.test(title)) {
        skipped.push({ releaseKey: row.releaseKey, title });
        continue;
      }

      const entry = {
        gogId: row.releaseKey.replace(/^gog_/, ''),
        releaseKey: row.releaseKey,
        title,
        minutes: minutesByKey.get(row.releaseKey) || 0,
        lastPlayed: lastPlayedByKey.get(row.releaseKey) || null,
        achievements: achievementsByKey.get(row.releaseKey) || [],
      };

      const key = title.toLowerCase();
      const existing = byTitle.get(key);
      if (!existing) {
        byTitle.set(key, entry);
        games.push(entry);
        continue;
      }
      // Fusión: la clave con más datos manda como id externo.
      existing.minutes += entry.minutes;
      if (!existing.lastPlayed || (entry.lastPlayed && entry.lastPlayed > existing.lastPlayed)) {
        existing.lastPlayed = entry.lastPlayed;
      }
      if (entry.achievements.length > existing.achievements.length) {
        existing.achievements = entry.achievements;
        existing.gogId = entry.gogId;
        existing.releaseKey = entry.releaseKey;
      }
    }

    return { games, skipped };
  });
}

module.exports = { readGogLibrary, DEFAULT_DB_PATH };
