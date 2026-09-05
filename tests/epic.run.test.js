const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openDatabase } = require('../db/connection');
const { migrate } = require('../db/migrate');
const gamesDb = require('../db/games');
const { runEpicSync, loginWithCode } = require('../epic/run');
const { fileAuthStore } = require('../epic/file-auth-store');

// Guarda en memoria en vez de en fichero — así se prueba el mismo camino
// que usa el móvil (que no tiene node:fs) vía db/settings.js.
function memoryAuthStore(initial = null) {
  let stored = initial;
  return {
    load: () => stored,
    save: (token) => {
      stored = token;
    },
    peek: () => stored,
  };
}

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'steamdb-epic-'));
}

function tempDb(dir) {
  const db = openDatabase(path.join(dir, 'test.sqlite'));
  migrate(db);
  return db;
}

// fetch de mentira para Epic: token + playtime + assets + catálogo. El
// playtime se puede mutar entre syncs.
function fakeEpic(state) {
  return async (url, options = {}) => {
    const u = String(url);
    if (u.includes('/oauth/token')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          access_token: 'AT',
          refresh_token: 'RT-' + (state.refreshCount = (state.refreshCount || 0) + 1),
          account_id: 'acc-1',
          expires_at: '2099-01-01T00:00:00Z',
        }),
      };
    }
    if (u.includes('/playtime/account/')) {
      return {
        ok: true,
        status: 200,
        json: async () => state.playtime.map((p) => ({ artifactId: p.id, totalTime: p.minutes * 60 })),
      };
    }
    if (u.includes('/launcher/api/public/assets/Windows')) {
      return {
        ok: true,
        status: 200,
        json: async () =>
          state.assets.map((a) => ({ appName: a.id, catalogItemId: 'cat-' + a.id, namespace: 'ns' })),
      };
    }
    const m = u.match(/\/bulk\/items\?id=cat-([^&]+)/);
    if (m) {
      const meta = state.catalog[m[1]];
      return {
        ok: true,
        status: 200,
        json: async () =>
          meta
            ? { ['cat-' + m[1]]: { title: meta.title, keyImages: [{ type: 'Thumbnail', url: meta.icon }], categories: meta.categories.map((p) => ({ path: p })) } }
            : {},
      };
    }
    throw new Error(`fetch inesperado a ${u}`);
  };
}

function baseState() {
  return {
    playtime: [
      { id: 'AlanWake', minutes: 500 },
      { id: 'UnrealEngine', minutes: 999 },
    ],
    assets: [{ id: 'AlanWake' }, { id: 'UnrealEngine' }],
    catalog: {
      AlanWake: { title: 'Alan Wake', icon: 'http://i/aw.jpg', categories: ['games'] },
      UnrealEngine: { title: 'Unreal Engine', icon: null, categories: ['engines'] },
    },
  };
}

function seedAuth(dir) {
  const authPath = path.join(dir, 'epic_auth.json');
  fs.writeFileSync(authPath, JSON.stringify({ refreshToken: 'RT0', accountId: 'acc-1' }));
  return authPath;
}

test('loginWithCode guarda el refresh token devuelto por Epic', async () => {
  const dir = tmpDir();
  const authPath = path.join(dir, 'epic_auth.json');
  const state = {};

  const accountId = await loginWithCode('some-code', {
    authStore: fileAuthStore(authPath),
    fetchImpl: fakeEpic(state),
  });
  assert.equal(accountId, 'acc-1');
  assert.deepEqual(JSON.parse(fs.readFileSync(authPath, 'utf8')), { refreshToken: 'RT-1', accountId: 'acc-1' });
});

test('runEpicSync exige haber hecho login antes', async () => {
  const dir = tmpDir();
  const db = tempDb(dir);
  await assert.rejects(
    () =>
      runEpicSync({
        db,
        authStore: fileAuthStore(path.join(dir, 'no-existe.json')),
        fetchImpl: fakeEpic({}),
      }),
    /epic:login/
  );
});

test('primera sync: da de alta los juegos de Epic, descarta lo que no es juego, y rota el refresh token', async () => {
  const dir = tmpDir();
  const db = tempDb(dir);
  const authPath = seedAuth(dir);
  const state = baseState();

  const result = await runEpicSync({ db, authStore: fileAuthStore(authPath), fetchImpl: fakeEpic(state), delayMs: 0 });
  assert.equal(result.added, 1);
  assert.equal(result.skipped, 1); // Unreal Engine no es 'games'

  const games = gamesDb.listGames(db);
  assert.equal(games.length, 1);
  assert.equal(games[0].title, 'Alan Wake');
  assert.equal(games[0].source, 'epic');
  assert.equal(games[0].platform, 'Epic');
  assert.equal(games[0].totalMinutes, 500);

  const sessions = db.prepare('SELECT * FROM play_sessions').all();
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].origin, 'epic_sync');

  // el refresh token guardado ya no es el inicial
  assert.notEqual(JSON.parse(fs.readFileSync(authPath, 'utf8')).refreshToken, 'RT0');
});

test('segunda sync con más minutos deriva una sesión del intervalo', async () => {
  const dir = tmpDir();
  const db = tempDb(dir);
  const authPath = seedAuth(dir);
  const state = baseState();
  const store = fileAuthStore(authPath);

  await runEpicSync({ db, authStore: store, fetchImpl: fakeEpic(state), delayMs: 0 });
  state.playtime[0].minutes = 560;
  const second = await runEpicSync({ db, authStore: store, fetchImpl: fakeEpic(state), delayMs: 0 });
  assert.equal(second.updated, 1);

  const game = gamesDb.getGameByExternalId(db, 'epic', 'AlanWake');
  const sessions = db.prepare('SELECT * FROM play_sessions WHERE game_id = ? ORDER BY id').all(game.id);
  assert.equal(sessions.length, 2);
  assert.equal(sessions[1].minutes, 60);
  assert.ok(sessions[1].started_at);
});

test('un juego con horas pero sin entrada en la biblioteca se descarta sin romper', async () => {
  const dir = tmpDir();
  const db = tempDb(dir);
  const authPath = seedAuth(dir);
  const state = baseState();
  state.playtime.push({ id: 'Huerfano', minutes: 100 }); // sin asset

  const result = await runEpicSync({ db, authStore: fileAuthStore(authPath), fetchImpl: fakeEpic(state), delayMs: 0 });
  assert.equal(result.added, 1);
  assert.equal(result.skipped, 2);
});

test('loginWithCode y runEpicSync aceptan un authStore en memoria, sin tocar ningún fichero', async () => {
  const dir = tmpDir();
  const db = tempDb(dir);
  const state = baseState();
  const store = memoryAuthStore();

  const accountId = await loginWithCode('some-code', { authStore: store, fetchImpl: fakeEpic(state) });
  assert.equal(accountId, 'acc-1');
  assert.equal(store.peek().refreshToken, 'RT-1');

  const result = await runEpicSync({ db, authStore: store, fetchImpl: fakeEpic(state), delayMs: 0 });
  assert.equal(result.added, 1);
  // el refresh token en el store rotó, sin tocar ningún fichero
  assert.equal(store.peek().refreshToken, 'RT-2');
});

test('un fallo de Epic se registra en sync_runs y se propaga', async () => {
  const dir = tmpDir();
  const db = tempDb(dir);
  const authPath = seedAuth(dir);
  const fetchImpl = async () => {
    throw new Error('sin conexión');
  };

  await assert.rejects(
    () => runEpicSync({ db, authStore: fileAuthStore(authPath), fetchImpl, delayMs: 0 }),
    /sin conexión/
  );
  const run = db.prepare('SELECT * FROM sync_runs ORDER BY id DESC').get();
  assert.equal(run.status, 'error');
});
