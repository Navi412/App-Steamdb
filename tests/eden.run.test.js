const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openDatabase } = require('../db/connection');
const { migrate } = require('../db/migrate');
const gamesDb = require('../db/games');
const edenClient = require('../eden/client');
const { runEdenSync } = require('../eden/run');

function tempDb() {
  const db = openDatabase(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'steamdb-eden-')), 'test.sqlite'));
  migrate(db);
  return db;
}

// El runner llama a edenClient.readEdenLibrary; en los tests se sustituye
// por una función que devuelve una biblioteca fija y mutable entre syncs.
function stubLibrary(state) {
  const original = edenClient.readEdenLibrary;
  edenClient.readEdenLibrary = () => ({
    games: state.games ?? [],
    skipped: state.skipped ?? [],
  });
  return () => {
    edenClient.readEdenLibrary = original;
  };
}

test('primera sync: da de alta los juegos de Eden como Switch, con una sesión de backlog por sus horas', (t) => {
  const db = tempDb();
  const restore = stubLibrary({
    games: [
      { edenId: '0100ECD018EBE000', title: 'Paper Mario: The Thousand-Year Door', minutes: 13, lastPlayed: null },
      { edenId: '0100000000010000', title: 'Super Mario Odyssey', minutes: 0, lastPlayed: null },
    ],
  });
  t.after(restore);

  const result = runEdenSync({ db });
  assert.equal(result.gamesSynced, 2);
  assert.equal(result.added, 2);

  const paperMario = gamesDb.getGameByExternalId(db, 'eden', '0100ECD018EBE000');
  assert.equal(paperMario.source, 'eden');
  assert.equal(paperMario.platform, 'Switch');
  assert.equal(paperMario.totalMinutes, 13);

  const sessions = db.prepare('SELECT * FROM play_sessions WHERE game_id = ?').all(paperMario.id);
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].origin, 'eden_sync');
  assert.equal(sessions[0].started_at, null);

  // Un juego a 0 horas se da de alta igual, con instantánea y sin sesión.
  const odyssey = gamesDb.getGameByExternalId(db, 'eden', '0100000000010000');
  assert.equal(odyssey.totalMinutes, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM play_sessions WHERE game_id = ?').get(odyssey.id).n, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM playtime_snapshots WHERE source = 'eden'").get().n, 2);
});

test('segunda sync con más minutos deriva una sesión del intervalo; sin cambios no apila instantánea', (t) => {
  const db = tempDb();
  const state = { games: [{ edenId: '1', title: 'Paper Mario', minutes: 13, lastPlayed: null }] };
  t.after(stubLibrary(state));

  runEdenSync({ db });
  state.games[0].minutes = 43; // +30
  const second = runEdenSync({ db });
  assert.equal(second.updated, 1);

  const game = gamesDb.getGameByExternalId(db, 'eden', '1');
  const sessions = db.prepare('SELECT * FROM play_sessions WHERE game_id = ? ORDER BY id').all(game.id);
  assert.equal(sessions.length, 2);
  assert.equal(sessions[1].minutes, 30);
  assert.ok(sessions[1].started_at);

  const third = runEdenSync({ db }); // sin cambios
  assert.equal(third.unchanged, 1);
  assert.equal(third.updated, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM playtime_snapshots WHERE game_id = ?').get(game.id).n, 2);
});

test('si el contador de Eden baja entre syncs, se registra anomalía y ninguna sesión', (t) => {
  const db = tempDb();
  const state = { games: [{ edenId: '1', title: 'Paper Mario', minutes: 100, lastPlayed: null }] };
  t.after(stubLibrary(state));

  runEdenSync({ db });
  state.games[0].minutes = 10;
  runEdenSync({ db });

  const game = gamesDb.getGameByExternalId(db, 'eden', '1');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM play_sessions WHERE game_id = ?').get(game.id).n, 1);
  const anomalies = db.prepare('SELECT * FROM sync_anomalies WHERE game_id = ?').all(game.id);
  assert.equal(anomalies.length, 1);
  assert.equal(anomalies[0].kind, 'playtime_decreased');
});

test('informa de los archivos descartados por no traer un id de título reconocible', (t) => {
  const db = tempDb();
  t.after(
    stubLibrary({
      games: [{ edenId: '1', title: 'Paper Mario', minutes: 1, lastPlayed: null }],
      skipped: [{ file: 'readme.nsp', path: 'C:/roms/readme.nsp' }],
    })
  );

  const result = runEdenSync({ db });
  assert.equal(result.skippedFiles.length, 1);
  assert.deepEqual(result.skippedFiles, ['readme.nsp']);
});

test('una segunda sync no borra la carátula que había rellenado IGDB (Eden nunca trae icono propio)', (t) => {
  const db = tempDb();
  const state = { games: [{ edenId: '0100ECD018EBE000', title: 'Paper Mario', minutes: 13, lastPlayed: null }] };
  t.after(stubLibrary(state));

  runEdenSync({ db });
  const game = gamesDb.getGameByExternalId(db, 'eden', '0100ECD018EBE000');
  gamesDb.setIgdbTimes(db, game.id, {
    igdbId: 3349,
    mainMinutes: 1500,
    completionistMinutes: 3000,
    coverUrl: 'https://images.igdb.com/igdb/image/upload/t_cover_big/paper-mario.jpg',
    source: 'eden',
  });
  assert.equal(
    gamesDb.getGameById(db, game.id).iconUrl,
    'https://images.igdb.com/igdb/image/upload/t_cover_big/paper-mario.jpg'
  );

  state.games[0].minutes = 20; // el usuario le da a "Sincronizar" otra vez
  runEdenSync({ db });

  assert.equal(
    gamesDb.getGameById(db, game.id).iconUrl,
    'https://images.igdb.com/igdb/image/upload/t_cover_big/paper-mario.jpg'
  );
});

test('un fallo leyendo la carpeta de Eden se registra en sync_runs y se propaga', (t) => {
  const db = tempDb();
  const original = edenClient.readEdenLibrary;
  edenClient.readEdenLibrary = () => {
    throw new Error('no se encontró la carpeta de datos de Eden en X');
  };
  t.after(() => {
    edenClient.readEdenLibrary = original;
  });

  assert.throws(() => runEdenSync({ db }), /Eden/);
  const run = db.prepare('SELECT * FROM sync_runs ORDER BY id DESC').get();
  assert.equal(run.status, 'error');
});
