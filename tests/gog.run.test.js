const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openDatabase } = require('../db/connection');
const { migrate } = require('../db/migrate');
const gamesDb = require('../db/games');
const achievementsDb = require('../db/achievements');
const gogClient = require('../gog/client');
const { runGogSync } = require('../gog/run');

function tempDb() {
  const db = openDatabase(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'steamdb-gog-')), 'test.sqlite'));
  migrate(db);
  return db;
}

// El runner llama a gogClient.readGogLibrary; en los tests se sustituye por
// una función que devuelve una biblioteca fija y mutable entre syncs.
function stubLibrary(state) {
  const original = gogClient.readGogLibrary;
  gogClient.readGogLibrary = () => ({
    games: state.games ?? [],
    skipped: state.skipped ?? [],
  });
  return () => {
    gogClient.readGogLibrary = original;
  };
}

test('primera sync: da de alta los juegos de GOG y una sesión de backlog por sus horas', (t) => {
  const db = tempDb();
  const restore = stubLibrary({
    games: [
      {
        gogId: '1423049311',
        releaseKey: 'gog_1423049311',
        title: 'Cyberpunk 2077',
        minutes: 4678,
        lastPlayed: '2025-05-25T02:11:04.000Z',
        achievements: [
          { apiName: 'TheFool', name: 'The Fool', description: null, achieved: true, unlockedAt: '2022-09-26T21:02:17.000Z' },
          { apiName: 'TheLovers', name: 'The Lovers', description: null, achieved: false, unlockedAt: null },
        ],
      },
      { gogId: '1207658924', releaseKey: 'gog_1207658924', title: 'The Witcher: Enhanced Edition', minutes: 0, lastPlayed: null, achievements: [] },
    ],
  });
  t.after(restore);

  const result = runGogSync({ db });
  assert.equal(result.gamesSynced, 2);
  assert.equal(result.added, 2);

  const cp = gamesDb.getGameByExternalId(db, 'gog', '1423049311');
  assert.equal(cp.source, 'gog');
  assert.equal(cp.platform, 'GOG');
  assert.equal(cp.totalMinutes, 4678);

  const sessions = db.prepare('SELECT * FROM play_sessions WHERE game_id = ?').all(cp.id);
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].origin, 'gog_sync');
  assert.equal(sessions[0].started_at, null);

  const achs = achievementsDb.listAchievementsForGame(db, cp.id);
  assert.equal(achs.length, 2);
  assert.equal(achs.filter((a) => a.achieved).length, 1);

  // Un juego a 0 horas se da de alta igual, con instantánea y sin sesión.
  const witcher = gamesDb.getGameByExternalId(db, 'gog', '1207658924');
  assert.equal(witcher.totalMinutes, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM play_sessions WHERE game_id = ?').get(witcher.id).n, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM playtime_snapshots WHERE source = 'gog'").get().n, 2);
});

test('segunda sync con más minutos deriva una sesión del intervalo; sin cambios no apila instantánea', (t) => {
  const db = tempDb();
  const state = {
    games: [{ gogId: '1', releaseKey: 'gog_1', title: 'Cyberpunk 2077', minutes: 4678, lastPlayed: null, achievements: [] }],
  };
  t.after(stubLibrary(state));

  runGogSync({ db });
  state.games[0].minutes = 4778; // +100
  const second = runGogSync({ db });
  assert.equal(second.updated, 1);

  const cp = gamesDb.getGameByExternalId(db, 'gog', '1');
  const sessions = db.prepare('SELECT * FROM play_sessions WHERE game_id = ? ORDER BY id').all(cp.id);
  assert.equal(sessions.length, 2);
  assert.equal(sessions[1].minutes, 100);
  assert.ok(sessions[1].started_at);

  const third = runGogSync({ db }); // sin cambios
  assert.equal(third.unchanged, 1);
  assert.equal(third.updated, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM playtime_snapshots WHERE game_id = ?").get(cp.id).n, 2);
});

test('si el contador de GOG baja entre syncs, se registra anomalía y ninguna sesión', (t) => {
  const db = tempDb();
  const state = {
    games: [{ gogId: '1', releaseKey: 'gog_1', title: 'Cyberpunk 2077', minutes: 4678, lastPlayed: null, achievements: [] }],
  };
  t.after(stubLibrary(state));

  runGogSync({ db });
  state.games[0].minutes = 40;
  runGogSync({ db });

  const cp = gamesDb.getGameByExternalId(db, 'gog', '1');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM play_sessions WHERE game_id = ?').get(cp.id).n, 1);
  const anomalies = db.prepare('SELECT * FROM sync_anomalies WHERE game_id = ?').all(cp.id);
  assert.equal(anomalies.length, 1);
  assert.equal(anomalies[0].kind, 'playtime_decreased');
});

test('informa de los extras descartados', (t) => {
  const db = tempDb();
  t.after(
    stubLibrary({
      games: [{ gogId: '1', releaseKey: 'gog_1', title: 'Cyberpunk 2077', minutes: 1, lastPlayed: null, achievements: [] }],
      skipped: [
        { releaseKey: 'gog_2', title: 'CDPR Gear - discount code' },
        { releaseKey: 'gog_3', title: null },
      ],
    })
  );

  const result = runGogSync({ db });
  assert.equal(result.skippedNonGames, 2);
  assert.deepEqual(result.skippedTitles, ['CDPR Gear - discount code']);
});

test('un fallo leyendo Galaxy se registra en sync_runs y se propaga', (t) => {
  const db = tempDb();
  const original = gogClient.readGogLibrary;
  gogClient.readGogLibrary = () => {
    throw new Error('no se encontró la base de GOG Galaxy en X');
  };
  t.after(() => {
    gogClient.readGogLibrary = original;
  });

  assert.throws(() => runGogSync({ db }), /GOG Galaxy/);
  const run = db.prepare('SELECT * FROM sync_runs ORDER BY id DESC').get();
  assert.equal(run.status, 'error');
});
