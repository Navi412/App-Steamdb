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

  const games = db
    .prepare(
      `SELECT g.*, e.external_id FROM games g
       JOIN game_external_ids e ON e.game_id = g.id AND e.source = 'steam'
       WHERE g.source = 'steam' ORDER BY CAST(e.external_id AS INTEGER)`
    )
    .all();
  assert.equal(games.length, 2);
  assert.equal(games[0].external_id, '400');
  assert.equal(games[1].external_id, '620');
  assert.equal(games[1].title, 'Portal 2');
  assert.equal(games[1].platform, 'Steam');

  const snapshots = db.prepare('SELECT * FROM playtime_snapshots').all();
  assert.equal(snapshots.length, 2);
  assert.equal(snapshots[0].source, 'steam');

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
  const externalIds = db.prepare('SELECT * FROM game_external_ids').all();
  assert.equal(externalIds.length, 1);

  const snapshots = db.prepare('SELECT * FROM playtime_snapshots').all();
  assert.equal(snapshots.length, 2);
});

test('la primera sincronización de un juego crea una sesión de backlog', async () => {
  const db = tempDb();
  const fetchImpl = fakeFetch({
    response: { games: [{ appid: 620, name: 'Portal 2', playtime_forever: 300 }] },
  });

  await runSync({ db, apiKey: 'K', steamId: 'S', fetchImpl });

  const sessions = db.prepare('SELECT * FROM play_sessions').all();
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].minutes, 300);
  assert.equal(sessions[0].started_at, null);
  assert.equal(sessions[0].precision, 'derived');
  assert.equal(sessions[0].origin, 'steam_sync');
  assert.ok(sessions[0].source_snapshot_id);
});

test('una segunda sincronización con más minutos deriva una sesión del intervalo', async () => {
  const db = tempDb();
  let playtime = 300;
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ response: { games: [{ appid: 620, name: 'Portal 2', playtime_forever: playtime }] } }),
  });

  await runSync({ db, apiKey: 'K', steamId: 'S', fetchImpl });
  playtime = 360;
  await runSync({ db, apiKey: 'K', steamId: 'S', fetchImpl });

  const sessions = db.prepare('SELECT * FROM play_sessions ORDER BY id').all();
  assert.equal(sessions.length, 2);
  assert.equal(sessions[1].minutes, 60);
  assert.ok(sessions[1].started_at);
});

test('una bajada de minutos entre sincronizaciones registra una anomalía y ninguna sesión nueva', async () => {
  const db = tempDb();
  let playtime = 300;
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ response: { games: [{ appid: 620, name: 'Portal 2', playtime_forever: playtime }] } }),
  });

  await runSync({ db, apiKey: 'K', steamId: 'S', fetchImpl });
  playtime = 50;
  await runSync({ db, apiKey: 'K', steamId: 'S', fetchImpl });

  const sessions = db.prepare('SELECT * FROM play_sessions').all();
  assert.equal(sessions.length, 1); // solo la sesión de backlog de la primera sincronización

  const anomalies = db.prepare('SELECT * FROM sync_anomalies').all();
  assert.equal(anomalies.length, 1);
  assert.equal(anomalies[0].kind, 'playtime_decreased');
});

function fakeFetchWithAchievements(ownedGamesPayload, achievementsByAppId) {
  return async (url) => {
    if (url.searchParams.has('appid')) {
      const appId = Number(url.searchParams.get('appid'));
      const payload = achievementsByAppId[appId] ?? { playerstats: { success: false, error: 'sin logros' } };
      return { ok: true, status: 200, json: async () => payload };
    }
    return { ok: true, status: 200, json: async () => ownedGamesPayload };
  };
}

test('runSync guarda los logros de cada juego', async () => {
  const db = tempDb();
  const fetchImpl = fakeFetchWithAchievements(
    { response: { games: [{ appid: 620, name: 'Portal 2', playtime_forever: 100 }] } },
    {
      620: {
        playerstats: {
          success: true,
          achievements: [
            { apiname: 'ACH_A', achieved: 1, unlocktime: 1700000000, name: 'A' },
            { apiname: 'ACH_B', achieved: 0, unlocktime: 0, name: 'B' },
          ],
        },
      },
    }
  );

  await runSync({ db, apiKey: 'K', steamId: 'S', fetchImpl });

  const achievements = db.prepare('SELECT * FROM achievements ORDER BY api_name').all();
  assert.equal(achievements.length, 2);
  assert.equal(achievements[0].achieved, 1);
  assert.equal(achievements[1].achieved, 0);

  const gamesDb = require('../db/games');
  const game = gamesDb.getGameByExternalId(db, 'steam', '620');
  const withStats = gamesDb.getGameById(db, game.id);
  assert.equal(withStats.achievementsTotal, 2);
  assert.equal(withStats.achievementsUnlocked, 1);
});

test('un juego sin logros no rompe la sincronización del resto', async () => {
  const db = tempDb();
  const fetchImpl = fakeFetchWithAchievements(
    {
      response: {
        games: [
          { appid: 620, name: 'Portal 2', playtime_forever: 100 },
          { appid: 999, name: 'Juego sin logros', playtime_forever: 5 },
        ],
      },
    },
    {
      620: { playerstats: { success: true, achievements: [{ apiname: 'ACH_A', achieved: 1, unlocktime: 1700000000 }] } },
      // 999 no está en el mapa: responde "sin logros" por defecto
    }
  );

  const result = await runSync({ db, apiKey: 'K', steamId: 'S', fetchImpl });
  assert.equal(result.gamesSynced, 2);

  const achievements = db.prepare('SELECT * FROM achievements').all();
  assert.equal(achievements.length, 1);

  const run = db.prepare('SELECT * FROM sync_runs').get();
  assert.equal(run.status, 'ok');
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
