const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { readGogLibrary } = require('../gog/client');

const USER = 53934609519422253n;
const OTHER_USER = 11111111111111111n;

// Construye una base SQLite con la forma (mínima) de la de GOG Galaxy.
// `spec` describe lo que hay dentro sin repetir SQL en cada test.
function makeGalaxyDb(spec = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'steamdb-gog-fixture-'));
  const file = path.join(dir, 'galaxy-2.0.db');
  const db = new DatabaseSync(file);
  db.exec(`
    CREATE TABLE GamePieceTypes (id INTEGER PRIMARY KEY, type TEXT);
    CREATE TABLE GamePieces (releaseKey TEXT, gamePieceTypeId INTEGER, userId INTEGER, value TEXT, languageId INTEGER);
    CREATE TABLE LibraryReleases (id INTEGER PRIMARY KEY, userId INTEGER, releaseKey TEXT);
    CREATE TABLE GameTimes (userId INTEGER, releaseKey TEXT, minutesInGame INTEGER);
    CREATE TABLE LastPlayedDates (userId INTEGER, gameReleaseKey TEXT, lastPlayedDate TEXT);
    CREATE TABLE UserAchievements (gameReleaseKey TEXT, userId INTEGER, apikey TEXT, unlockTime TEXT, isUnlocked INTEGER);
    CREATE TABLE LocalizedAchievements (gameReleaseKey TEXT, apikey TEXT, name TEXT, description TEXT, languageId INTEGER, isLocalized INTEGER);
  `);
  db.prepare('INSERT INTO GamePieceTypes (id, type) VALUES (197, ?), (317, ?), (314, ?)').run(
    'title',
    'originalTitle',
    'originalImages'
  );

  const user = spec.user ?? USER;
  for (const g of spec.library ?? []) {
    db.prepare('INSERT INTO LibraryReleases (userId, releaseKey) VALUES (?, ?)').run(g.user ?? user, g.releaseKey);
    if (g.title !== undefined) {
      db.prepare('INSERT INTO GamePieces (releaseKey, gamePieceTypeId, userId, value) VALUES (?, 197, ?, ?)').run(
        g.releaseKey,
        g.user ?? user,
        g.title === null ? null : JSON.stringify({ title: g.title })
      );
    }
    if (g.images !== undefined) {
      db.prepare('INSERT INTO GamePieces (releaseKey, gamePieceTypeId, userId, value) VALUES (?, 314, ?, ?)').run(
        g.releaseKey,
        g.user ?? user,
        g.images === null ? null : JSON.stringify(g.images)
      );
    }
    if (g.minutes !== undefined) {
      db.prepare('INSERT INTO GameTimes (userId, releaseKey, minutesInGame) VALUES (?, ?, ?)').run(
        g.user ?? user,
        g.releaseKey,
        g.minutes
      );
    }
    if (g.lastPlayed !== undefined) {
      db.prepare('INSERT INTO LastPlayedDates (userId, gameReleaseKey, lastPlayedDate) VALUES (?, ?, ?)').run(
        g.user ?? user,
        g.releaseKey,
        g.lastPlayed
      );
    }
    for (const a of g.achievements ?? []) {
      db.prepare(
        'INSERT INTO UserAchievements (gameReleaseKey, userId, apikey, unlockTime, isUnlocked) VALUES (?, ?, ?, ?, ?)'
      ).run(g.releaseKey, g.user ?? user, a.apiName, a.unlockTime ?? null, a.achieved ? 1 : 0);
      for (const langId of a.langs ?? [16]) {
        db.prepare(
          'INSERT INTO LocalizedAchievements (gameReleaseKey, apikey, name, description, languageId, isLocalized) VALUES (?, ?, ?, ?, ?, 0)'
        ).run(g.releaseKey, a.apiName, a.name ?? null, a.description ?? null, langId);
      }
    }
  }
  db.close();
  return file;
}

test('devuelve solo los juegos gog del usuario, con horas y última vez jugado', () => {
  const dbPath = makeGalaxyDb({
    library: [
      { releaseKey: 'gog_1423049311', title: 'Cyberpunk 2077', minutes: 4678, lastPlayed: '2025-05-25 02:11:04' },
      { releaseKey: 'gog_1207658924', title: 'The Witcher: Enhanced Edition', minutes: 0 },
      // de otra plataforma que Galaxy recopila: se ignora
      { releaseKey: 'steam_292030', title: 'The Witcher 3', minutes: 9000 },
      // de otra cuenta de Galaxy en la misma máquina: se ignora
      { releaseKey: 'gog_999', title: 'Otra cuenta', minutes: 10, user: OTHER_USER },
    ],
  });

  const { games } = readGogLibrary({ dbPath });
  assert.deepEqual(
    games.map((g) => g.title).sort(),
    ['Cyberpunk 2077', 'The Witcher: Enhanced Edition']
  );

  const cp = games.find((g) => g.title === 'Cyberpunk 2077');
  assert.equal(cp.gogId, '1423049311');
  assert.equal(cp.releaseKey, 'gog_1423049311');
  assert.equal(cp.minutes, 4678);
  assert.equal(cp.lastPlayed, '2025-05-25T02:11:04.000Z');

  const witcher = games.find((g) => g.title.startsWith('The Witcher'));
  assert.equal(witcher.minutes, 0);
  assert.equal(witcher.lastPlayed, null);
});

test('saca la carátula vertical de originalImages, con el icono cuadrado de reserva', () => {
  const dbPath = makeGalaxyDb({
    library: [
      {
        releaseKey: 'gog_1',
        title: 'Cyberpunk 2077',
        minutes: 1,
        images: {
          verticalCover: 'https://images.gog.com/abc_glx_vertical_cover.webp?namespace=gamesdb',
          squareIcon: 'https://images.gog.com/def_glx_square_icon_v2.webp',
        },
      },
      {
        releaseKey: 'gog_2',
        title: 'The Witcher',
        minutes: 0,
        images: { verticalCover: null, squareIcon: 'https://images.gog.com/xyz_glx_square_icon_v2.webp' },
      },
      { releaseKey: 'gog_3', title: 'Gwent', minutes: 0 }, // sin pieza de imagen
    ],
  });

  const { games } = readGogLibrary({ dbPath });
  const byTitle = Object.fromEntries(games.map((g) => [g.title, g]));
  assert.equal(
    byTitle['Cyberpunk 2077'].coverUrl,
    'https://images.gog.com/abc_glx_vertical_cover.webp?namespace=gamesdb'
  );
  assert.equal(byTitle['The Witcher'].coverUrl, 'https://images.gog.com/xyz_glx_square_icon_v2.webp');
  assert.equal(byTitle['Gwent'].coverUrl, null);
});

test('los extras sin juego (códigos de descuento) van a "skipped", no a "games"', () => {
  const dbPath = makeGalaxyDb({
    library: [
      { releaseKey: 'gog_1', title: 'Cyberpunk 2077', minutes: 10 },
      { releaseKey: 'gog_2', title: 'CDPR Gear - discount code', minutes: 0 },
      { releaseKey: 'gog_3', title: 'CDPR Merch Store - discount codes', minutes: 0 },
      { releaseKey: 'gog_4', title: null }, // sin pieza de título
    ],
  });

  const { games, skipped } = readGogLibrary({ dbPath });
  assert.deepEqual(games.map((g) => g.title), ['Cyberpunk 2077']);
  assert.deepEqual(
    skipped.map((s) => s.releaseKey).sort(),
    ['gog_2', 'gog_3', 'gog_4']
  );
});

test('vuelca los logros de Galaxy: nombre/descripción localizados y fecha solo si está desbloqueado', () => {
  const dbPath = makeGalaxyDb({
    library: [
      {
        releaseKey: 'gog_1423049311',
        title: 'Cyberpunk 2077',
        minutes: 4678,
        achievements: [
          { apiName: 'TheFool', name: 'The Fool', description: 'Become a mercenary.', achieved: true, unlockTime: '2022-09-26 21:02:17' },
          { apiName: 'TheLovers', name: 'The Lovers', description: 'Steal the Relic.', achieved: false },
        ],
      },
    ],
  });

  const { games } = readGogLibrary({ dbPath });
  const achs = games[0].achievements.sort((a, b) => a.apiName.localeCompare(b.apiName));
  assert.equal(achs.length, 2);
  assert.deepEqual(achs[0], {
    apiName: 'TheFool',
    name: 'The Fool',
    description: 'Become a mercenary.',
    achieved: true,
    unlockedAt: '2022-09-26T21:02:17.000Z',
  });
  assert.equal(achs[1].achieved, false);
  assert.equal(achs[1].unlockedAt, null);
});

test('logros con varios idiomas no se multiplican: una fila por apikey', () => {
  const dbPath = makeGalaxyDb({
    library: [
      {
        releaseKey: 'gog_1',
        title: 'Cyberpunk 2077',
        minutes: 1,
        achievements: [
          { apiName: 'TheFool', name: 'The Fool', achieved: true, unlockTime: '2022-09-26 21:02:17', langs: [1, 16, 22] },
        ],
      },
    ],
  });

  const { games } = readGogLibrary({ dbPath });
  assert.equal(games[0].achievements.length, 1);
});

test('dos claves de GOG con el mismo título se funden en un juego', () => {
  const dbPath = makeGalaxyDb({
    library: [
      {
        releaseKey: 'gog_1423049311',
        title: 'Cyberpunk 2077',
        minutes: 4678,
        lastPlayed: '2025-05-25 02:11:04',
        achievements: [
          { apiName: 'TheFool', name: 'The Fool', achieved: true, unlockTime: '2022-09-26 21:02:17' },
          { apiName: 'TheLovers', name: 'The Lovers', achieved: false },
        ],
      },
      {
        releaseKey: 'gog_2093619782',
        title: 'Cyberpunk 2077',
        minutes: 0,
        images: { verticalCover: 'https://images.gog.com/cp_glx_vertical_cover.webp' },
      },
    ],
  });

  const { games } = readGogLibrary({ dbPath });
  assert.equal(games.length, 1);
  assert.equal(games[0].minutes, 4678);
  assert.equal(games[0].gogId, '1423049311');
  assert.equal(games[0].achievements.length, 2);
  // la carátula la aporta la otra clave: la fusión no debe perderla
  assert.equal(games[0].coverUrl, 'https://images.gog.com/cp_glx_vertical_cover.webp');
});

test('si no existe la base de Galaxy, lanza un error claro', () => {
  assert.throws(
    () => readGogLibrary({ dbPath: path.join(os.tmpdir(), 'no-hay-galaxy-aqui.db') }),
    /GOG Galaxy/
  );
});
