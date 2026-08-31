const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openDatabase } = require('../db/connection');
const { migrate } = require('../db/migrate');
const gamesDb = require('../db/games');
const { runXboxSync } = require('../xbox/run');

function tempDb() {
  const db = openDatabase(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'steamdb-xbox-')), 'test.sqlite'));
  migrate(db);
  return db;
}

// fetch de mentira para OpenXBL: historial + minutaje por título, ambos
// mutables entre llamadas para simular varias syncs. Por defecto los
// juegos figuran como "jugados ahora mismo" (lastPlayed en el futuro) para
// que la sync no los salte por falta de novedades.
function fakeXbl(state) {
  return async (url) => {
    const u = String(url);
    if (u.includes('/player/titleHistory')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          code: 200,
          content: {
            titles: state.titles.map((t) => ({
              titleId: t.titleId,
              name: t.name,
              type: 'Game',
              displayImage: t.icon ?? null,
              gamePass: { isGamePass: Boolean(t.gamePass) },
              titleHistory: { lastTimePlayed: t.lastPlayed ?? '2099-01-01T00:00:00Z' },
            })),
          },
        }),
      };
    }
    const m = u.match(/\/achievements\/stats\/(\d+)/);
    if (m) {
      const mins = state.minutes[m[1]];
      const stats = mins == null ? [] : [{ name: 'MinutesPlayed', type: 'Integer', value: String(mins) }];
      return {
        ok: true,
        status: 200,
        json: async () => ({ code: 200, content: { statlistscollection: [{ stats }] } }),
      };
    }
    throw new Error(`fetch inesperado a ${u}`);
  };
}

function baseState() {
  return {
    titles: [
      { titleId: '111', name: 'Persona 3 Reload', gamePass: true, icon: 'http://i/p3.png' },
      { titleId: '222', name: 'Herdling', gamePass: true },
    ],
    minutes: { 111: 5631, 222: 300 },
  };
}

test('primera sync: da de alta los juegos de Xbox y una sesión de backlog por sus horas', async () => {
  const db = tempDb();
  const result = await runXboxSync({ db, apiKey: 'K', fetchImpl: fakeXbl(baseState()), delayMs: 0 });

  assert.equal(result.gamesSynced, 2);
  assert.equal(result.added, 2);

  const games = gamesDb.listGames(db);
  const p3 = games.find((g) => g.title === 'Persona 3 Reload');
  assert.equal(p3.source, 'xbox');
  assert.equal(p3.platform, 'Xbox');
  assert.equal(p3.steamAppId, null);
  assert.equal(p3.totalMinutes, 5631);
  assert.equal(gamesDb.getGameByExternalId(db, 'xbox', '111').id, p3.id);

  const sessions = db.prepare('SELECT * FROM play_sessions WHERE game_id = ?').all(p3.id);
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].origin, 'xbox_sync');
  assert.equal(sessions[0].started_at, null);

  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM playtime_snapshots WHERE source = 'xbox'").get().n, 2);
});

test('segunda sync con más minutos deriva una sesión del intervalo; sin cambios no crea nada', async () => {
  const db = tempDb();
  const state = baseState();
  const fetchImpl = fakeXbl(state);

  await runXboxSync({ db, apiKey: 'K', fetchImpl, delayMs: 0 });
  state.minutes[111] = 5731; // +100
  const second = await runXboxSync({ db, apiKey: 'K', fetchImpl, delayMs: 0 });
  assert.equal(second.updated, 2);

  const p3 = gamesDb.getGameByExternalId(db, 'xbox', '111');
  const sessions = db.prepare('SELECT * FROM play_sessions WHERE game_id = ? ORDER BY id').all(p3.id);
  assert.equal(sessions.length, 2);
  assert.equal(sessions[1].minutes, 100);
  assert.ok(sessions[1].started_at);

  const herdling = gamesDb.getGameByExternalId(db, 'xbox', '222');
  assert.equal(
    db.prepare('SELECT COUNT(*) AS n FROM play_sessions WHERE game_id = ?').get(herdling.id).n,
    1 // solo el backlog de la primera sync
  );
});

test('un juego sin novedades desde la última sync no gasta petición', async () => {
  const db = tempDb();
  const state = baseState();
  // lastPlayed en el pasado: tras la primera sync ya no hay nada nuevo.
  state.titles[0].lastPlayed = '2020-01-01T00:00:00Z';
  state.titles[1].lastPlayed = '2020-01-01T00:00:00Z';

  await runXboxSync({ db, apiKey: 'K', fetchImpl: fakeXbl(state), delayMs: 0 });
  state.minutes[111] = 9999; // cambia el contador, pero lastPlayed sigue viejo
  const second = await runXboxSync({ db, apiKey: 'K', fetchImpl: fakeXbl(state), delayMs: 0 });

  assert.equal(second.skipped, 2);
  assert.equal(second.updated, 0);
  const p3 = gamesDb.getGameByExternalId(db, 'xbox', '111');
  assert.equal(p3.totalMinutes, 5631); // no se volvió a mirar
});

test('un juego sin dato de minutos se da de alta con instantánea a 0 y sin sesión', async () => {
  const db = tempDb();
  const state = baseState();
  delete state.minutes['222'];

  const result = await runXboxSync({ db, apiKey: 'K', fetchImpl: fakeXbl(state), delayMs: 0 });
  assert.equal(result.skipped, 1);

  const herdling = gamesDb.getGameByExternalId(db, 'xbox', '222');
  assert.ok(herdling, 'el juego debería existir en la lista');
  assert.equal(herdling.totalMinutes, 0);

  const snap = db.prepare("SELECT * FROM playtime_snapshots WHERE game_id = ?").get(herdling.id);
  assert.equal(snap.playtime_forever_minutes, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM play_sessions WHERE game_id = ?').get(herdling.id).n, 0);
});

test('el presupuesto de peticiones detiene la pasada y la marca como stoppedEarly', async () => {
  const db = tempDb();
  const state = baseState();
  const result = await runXboxSync({ db, apiKey: 'K', fetchImpl: fakeXbl(state), delayMs: 0, requestBudget: 1 });

  assert.equal(result.stoppedEarly, true);
  assert.equal(result.pending, 1);
  assert.equal(gamesDb.listGames(db).length, 2); // los dos juegos se dan de alta igual
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM playtime_snapshots').get().n, 1); // solo uno con horas
});

test('si el contador de Xbox baja entre syncs, se registra anomalía y ninguna sesión', async () => {
  const db = tempDb();
  const state = baseState();
  const fetchImpl = fakeXbl(state);

  await runXboxSync({ db, apiKey: 'K', fetchImpl, delayMs: 0 });
  state.minutes[111] = 40;
  await runXboxSync({ db, apiKey: 'K', fetchImpl, delayMs: 0 });

  const p3 = gamesDb.getGameByExternalId(db, 'xbox', '111');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM play_sessions WHERE game_id = ?').get(p3.id).n, 1);
  const anomalies = db.prepare('SELECT * FROM sync_anomalies WHERE game_id = ?').all(p3.id);
  assert.equal(anomalies.length, 1);
  assert.equal(anomalies[0].kind, 'playtime_decreased');
});

test('un fallo de OpenXBL se registra en sync_runs y se propaga', async () => {
  const db = tempDb();
  const fetchImpl = async () => {
    throw new Error('sin conexión');
  };

  await assert.rejects(() => runXboxSync({ db, apiKey: 'K', fetchImpl, delayMs: 0 }), /sin conexión/);

  const run = db.prepare('SELECT * FROM sync_runs ORDER BY id DESC').get();
  assert.equal(run.status, 'error');
  assert.equal(run.error_message, 'sin conexión');
});
