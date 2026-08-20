const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openDatabase } = require('../db/connection');
const { migrate } = require('../db/migrate');
const { runSync } = require('../sync/run');

function tempDb() {
  const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'steamdb-sync-test-')), 'test.sqlite');
  const db = openDatabase(dbPath);
  migrate(db);
  return db;
}

function fakeFetch(payload) {
  return async () => ({ ok: true, status: 200, json: async () => payload });
}

test('runSync da de alta juegos steam y guarda una instantánea por juego', async () => {
  const db = tempDb();
  const fetchImpl = fakeFetch({
    response: {
      games: [
        { appid: 620, name: 'Portal 2', playtime_forever: 754, img_icon_url: 'abc' },
        { appid: 400, name: 'Portal', playtime_forever: 0 },
      ],
    },
  });

  const result = await runSync({ db, apiKey: 'K', steamId: 'S', fetchImpl });
  assert.equal(result.gamesSynced, 2);

  const games = db.prepare("SELECT * FROM games WHERE source = 'steam' ORDER BY steam_appid").all();
  assert.equal(games.length, 2);
  assert.equal(games[0].steam_appid, 400);
  assert.equal(games[1].steam_appid, 620);
  assert.equal(games[1].title, 'Portal 2');
  assert.equal(games[1].platform, 'Steam');

  const snapshots = db.prepare('SELECT * FROM steam_snapshots').all();
  assert.equal(snapshots.length, 2);

  const run = db.prepare('SELECT * FROM sync_runs').get();
  assert.equal(run.status, 'ok');
  assert.equal(run.games_synced, 2);
});

test('sincronizar dos veces actualiza el juego existente en vez de duplicarlo', async () => {
  const db = tempDb();
  const fetchImpl = fakeFetch({
    response: { games: [{ appid: 620, name: 'Portal 2', playtime_forever: 100 }] },
  });

  await runSync({ db, apiKey: 'K', steamId: 'S', fetchImpl });
  await runSync({ db, apiKey: 'K', steamId: 'S', fetchImpl });

  const games = db.prepare("SELECT * FROM games WHERE source = 'steam'").all();
  assert.equal(games.length, 1);

  const snapshots = db.prepare('SELECT * FROM steam_snapshots').all();
  assert.equal(snapshots.length, 2);
});

test('un fallo de red se registra en sync_runs y se propaga', async () => {
  const db = tempDb();
  const fetchImpl = async () => {
    throw new Error('sin conexión');
  };

  await assert.rejects(() => runSync({ db, apiKey: 'K', steamId: 'S', fetchImpl }), /sin conexión/);

  const run = db.prepare('SELECT * FROM sync_runs').get();
  assert.equal(run.status, 'error');
  assert.equal(run.error_message, 'sin conexión');
});
