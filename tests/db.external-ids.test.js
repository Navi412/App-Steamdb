const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openDatabase } = require('../db/connection');
const { migrate } = require('../db/migrate');
const gamesDb = require('../db/games');
const { setExternalId, findGameIdByExternalId, externalIdsForGame } = require('../db/external-ids');

function tempDb() {
  const db = openDatabase(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'steamdb-extid-')), 'test.sqlite'));
  migrate(db);
  return db;
}

test('setExternalId liga un juego a un id de tienda y findGameIdByExternalId lo recupera', () => {
  const db = tempDb();
  const game = gamesDb.insertManualGame(db, { title: 'Hades', platform: 'Xbox' });

  setExternalId(db, game.id, 'xbox', '9NBLGGH4R315');
  assert.equal(findGameIdByExternalId(db, 'xbox', '9NBLGGH4R315'), game.id);
  assert.equal(findGameIdByExternalId(db, 'xbox', 'otro'), null);
  assert.equal(findGameIdByExternalId(db, 'steam', '9NBLGGH4R315'), null);
});

test('setExternalId es idempotente: repetir (juego, tienda) actualiza el id en vez de duplicar', () => {
  const db = tempDb();
  const game = gamesDb.insertManualGame(db, { title: 'Hades', platform: 'Xbox' });

  setExternalId(db, game.id, 'xbox', 'viejo');
  setExternalId(db, game.id, 'xbox', 'nuevo');

  assert.deepEqual(externalIdsForGame(db, game.id), { xbox: 'nuevo' });
  assert.equal(findGameIdByExternalId(db, 'xbox', 'viejo'), null);
});

test('un juego puede tener id en varias tiendas a la vez', () => {
  const db = tempDb();
  const game = gamesDb.insertManualGame(db, { title: 'Hades', platform: 'PC' });

  setExternalId(db, game.id, 'steam', '1145360');
  setExternalId(db, game.id, 'gog', '1898581586');

  assert.deepEqual(externalIdsForGame(db, game.id), { steam: '1145360', gog: '1898581586' });
});

test('upsertExternalGame da de alta el juego y su id externo, y a la segunda solo actualiza', () => {
  const db = tempDb();

  const first = gamesDb.upsertExternalGame(db, {
    source: 'xbox',
    externalId: 'ABC',
    title: 'Forza',
    iconUrl: null,
    platform: 'Xbox',
  });
  const second = gamesDb.upsertExternalGame(db, {
    source: 'xbox',
    externalId: 'ABC',
    title: 'Forza Horizon 5',
    iconUrl: 'http://x/i.png',
    platform: 'Xbox',
  });

  assert.equal(first.id, second.id);
  assert.equal(second.title, 'Forza Horizon 5');
  assert.equal(gamesDb.getGameByExternalId(db, 'xbox', 'ABC').id, first.id);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM games').get().n, 1);
});

test('upsertExternalGame normaliza el id externo a texto (un número entra como string)', () => {
  const db = tempDb();
  gamesDb.upsertExternalGame(db, { source: 'steam', externalId: 620, title: 'Portal 2', platform: 'Steam' });

  assert.ok(gamesDb.getGameByExternalId(db, 'steam', '620'));
  assert.ok(gamesDb.getGameByExternalId(db, 'steam', 620));
});
