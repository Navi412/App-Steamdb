const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openDatabase } = require('../db/connection');
const { migrate } = require('../db/migrate');
const gamesDb = require('../db/games');
const { enrichGamesWithIgdb } = require('../igdb/run');

function tempDb() {
  const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'steamdb-igdb-test-')), 'test.sqlite');
  const db = openDatabase(dbPath);
  migrate(db);
  return db;
}

// fetch de mentira que entiende los tres endpoints del cliente de IGDB:
// el token de Twitch, la búsqueda /v4/games y /v4/game_time_to_beats. Las
// respuestas de búsqueda y de tiempos se configuran por título / por id.
function fakeIgdb({ searchResults = {}, timesByIgdbId = {}, failTitles = [] } = {}) {
  return async (url, options = {}) => {
    const u = String(url);
    if (u.includes('oauth2/token')) {
      return { ok: true, status: 200, json: async () => ({ access_token: 'tok', expires_in: 3600 }) };
    }
    if (u.includes('v4/games')) {
      const title = options.body.match(/search "(.+?)"/)[1].replace(/\\"/g, '"');
      if (failTitles.includes(title)) return { ok: false, status: 500, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => searchResults[title] ?? [] };
    }
    if (u.includes('game_time_to_beats')) {
      const id = Number(options.body.match(/game_id = (\d+)/)[1]);
      const row = timesByIgdbId[id];
      return { ok: true, status: 200, json: async () => (row ? [row] : []) };
    }
    throw new Error(`fetch inesperado a ${u}`);
  };
}

const cred = { clientId: 'C', clientSecret: 'S', delayMs: 0 };

test('rellena los tiempos de todos los juegos que no tienen igdb_id', async () => {
  const db = tempDb();
  gamesDb.insertManualGame(db, { title: 'Celeste', platform: 'Switch' });
  gamesDb.insertManualGame(db, { title: 'Hades', platform: 'PC' });

  const fetchImpl = fakeIgdb({
    searchResults: {
      Celeste: [{ id: 1, name: 'Celeste' }],
      Hades: [{ id: 2, name: 'Hades' }],
    },
    timesByIgdbId: {
      1: { hastily: 480 * 60, completely: 2400 * 60 },
      2: { hastily: 1320 * 60, completely: 5400 * 60 },
    },
  });

  const stats = await enrichGamesWithIgdb({ db, ...cred, fetchImpl });
  assert.deepEqual(stats, { total: 2, updated: 2, withTimes: 2, notFound: 0, failed: 0 });

  const [celeste, hades] = gamesDb.listGames(db);
  assert.equal(celeste.igdbId, 1);
  assert.equal(celeste.igdbMainMinutes, 480);
  assert.equal(hades.igdbId, 2);
  assert.equal(hades.igdbCompletionistMinutes, 5400);
});

test('salta los juegos que ya tienen igdb_id, salvo con force', async () => {
  const db = tempDb();
  const g = gamesDb.insertManualGame(db, { title: 'Celeste', platform: 'Switch' });
  gamesDb.setIgdbTimes(db, g.id, { igdbId: 99, mainMinutes: 100, completionistMinutes: 200 });

  const fetchImpl = fakeIgdb({
    searchResults: { Celeste: [{ id: 1, name: 'Celeste' }] },
    timesByIgdbId: { 1: { hastily: 480 * 60, completely: 2400 * 60 } },
  });

  const skipped = await enrichGamesWithIgdb({ db, ...cred, fetchImpl });
  assert.equal(skipped.total, 0);
  assert.equal(gamesDb.getGameById(db, g.id).igdbMainMinutes, 100);

  const forced = await enrichGamesWithIgdb({ db, ...cred, fetchImpl, force: true });
  assert.equal(forced.total, 1);
  assert.equal(gamesDb.getGameById(db, g.id).igdbId, 1);
  assert.equal(gamesDb.getGameById(db, g.id).igdbMainMinutes, 480);
});

test('si la primera entrada duplicada de IGDB no trae tiempos, prueba la siguiente', async () => {
  const db = tempDb();
  const g = gamesDb.insertManualGame(db, { title: 'Hollow Knight', platform: 'PC' });

  const fetchImpl = fakeIgdb({
    searchResults: {
      'Hollow Knight': [
        { id: 10, name: 'Hollow Knight' }, // duplicado sin tiempos
        { id: 11, name: 'Hollow Knight' }, // el que sí los tiene
      ],
    },
    timesByIgdbId: { 11: { hastily: 1002 * 60, completely: 4392 * 60 } },
  });

  const stats = await enrichGamesWithIgdb({ db, ...cred, fetchImpl });
  assert.equal(stats.withTimes, 1);

  const saved = gamesDb.getGameById(db, g.id);
  assert.equal(saved.igdbId, 11);
  assert.equal(saved.igdbMainMinutes, 1002);
});

test('un juego sin resultados en IGDB se cuenta como notFound y no corta el resto', async () => {
  const db = tempDb();
  gamesDb.insertManualGame(db, { title: 'Juego Rarísimo', platform: 'PC' });
  const g2 = gamesDb.insertManualGame(db, { title: 'Celeste', platform: 'PC' });

  const fetchImpl = fakeIgdb({
    searchResults: { Celeste: [{ id: 1, name: 'Celeste' }] },
    timesByIgdbId: { 1: { hastily: 480 * 60, completely: null } },
  });

  const stats = await enrichGamesWithIgdb({ db, ...cred, fetchImpl });
  assert.equal(stats.notFound, 1);
  assert.equal(stats.updated, 1);
  assert.equal(gamesDb.getGameById(db, g2.id).igdbMainMinutes, 480);
});

test('un fallo HTTP con un juego se cuenta como failed y no aborta el resto', async () => {
  const db = tempDb();
  gamesDb.insertManualGame(db, { title: 'Roto', platform: 'PC' });
  const ok = gamesDb.insertManualGame(db, { title: 'Celeste', platform: 'PC' });

  const fetchImpl = fakeIgdb({
    searchResults: { Celeste: [{ id: 1, name: 'Celeste' }] },
    timesByIgdbId: { 1: { hastily: 480 * 60, completely: 2400 * 60 } },
    failTitles: ['Roto'],
  });

  const stats = await enrichGamesWithIgdb({ db, ...cred, fetchImpl });
  assert.equal(stats.failed, 1);
  assert.equal(stats.updated, 1);
  assert.equal(gamesDb.getGameById(db, ok.id).igdbId, 1);
});
