const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createServer } = require('../api/server');

function tempDbPath() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'steamdb-api-test-')), 'test.sqlite');
}

async function withServer(fn, { fetchImpl } = {}) {
  process.env.DB_PATH = tempDbPath();
  const server = createServer({ fetchImpl });
  await new Promise((resolve) => server.listen(0, resolve));
  const base = `http://localhost:${server.address().port}`;
  try {
    await fn(base);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function postJson(base, url, body) {
  return fetch(`${base}${url}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

test('POST /api/games crea un juego manual y aparece en GET /api/games', async () => {
  await withServer(async (base) => {
    const createRes = await postJson(base, '/api/games', { title: 'Hollow Knight', platform: 'Switch' });
    assert.equal(createRes.status, 201);
    const created = await createRes.json();
    assert.equal(created.title, 'Hollow Knight');
    assert.equal(created.source, 'manual');
    assert.equal(created.totalMinutes, 0);

    const games = await (await fetch(`${base}/api/games`)).json();
    assert.equal(games.length, 1);
    assert.equal(games[0].id, created.id);
  });
});

test('POST /api/games rechaza título vacío', async () => {
  await withServer(async (base) => {
    const res = await postJson(base, '/api/games', { title: '', platform: 'PC' });
    assert.equal(res.status, 400);
  });
});

test('registrar sesiones manuales suma minutos al total del juego', async () => {
  await withServer(async (base) => {
    const game = await (await postJson(base, '/api/games', { title: 'Celeste', platform: 'PC' })).json();

    await postJson(base, `/api/games/${game.id}/sessions`, { minutes: 90 });
    await postJson(base, `/api/games/${game.id}/sessions`, { minutes: 30, note: 'capítulo 3' });

    const games = await (await fetch(`${base}/api/games`)).json();
    assert.equal(games[0].totalMinutes, 120);

    const sessions = await (await fetch(`${base}/api/games/${game.id}/sessions`)).json();
    assert.equal(sessions.length, 2);
  });
});

test('GET /api/games/:id devuelve el juego, y 404 si no existe', async () => {
  await withServer(async (base) => {
    const created = await (await postJson(base, '/api/games', { title: 'Hades', platform: 'Switch' })).json();

    const res = await fetch(`${base}/api/games/${created.id}`);
    assert.equal(res.status, 200);
    const game = await res.json();
    assert.equal(game.title, 'Hades');

    const missing = await fetch(`${base}/api/games/999`);
    assert.equal(missing.status, 404);
  });
});

test('POST de sesión en juego inexistente da 404', async () => {
  await withServer(async (base) => {
    const res = await postJson(base, '/api/games/999/sessions', { minutes: 10 });
    assert.equal(res.status, 404);
  });
});

test('PATCH /api/games/:id archiva un juego', async () => {
  await withServer(async (base) => {
    const game = await (await postJson(base, '/api/games', { title: 'Outer Wilds', platform: 'PC' })).json();

    const patchRes = await fetch(`${base}/api/games/${game.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ archived: true }),
    });
    assert.equal(patchRes.status, 200);
    const updated = await patchRes.json();
    assert.equal(updated.archived, true);
  });
});

function withTwitchEnv(clientId, clientSecret, fn) {
  const prevId = process.env.TWITCH_CLIENT_ID;
  const prevSecret = process.env.TWITCH_CLIENT_SECRET;
  if (clientId === undefined) delete process.env.TWITCH_CLIENT_ID;
  else process.env.TWITCH_CLIENT_ID = clientId;
  if (clientSecret === undefined) delete process.env.TWITCH_CLIENT_SECRET;
  else process.env.TWITCH_CLIENT_SECRET = clientSecret;

  return fn().finally(() => {
    if (prevId === undefined) delete process.env.TWITCH_CLIENT_ID;
    else process.env.TWITCH_CLIENT_ID = prevId;
    if (prevSecret === undefined) delete process.env.TWITCH_CLIENT_SECRET;
    else process.env.TWITCH_CLIENT_SECRET = prevSecret;
  });
}

// El cliente de IGDB hace tres peticiones en cadena: token de Twitch,
// búsqueda en /games y consulta de /game_time_to_beats. fakeIgdbFetch
// responde a las tres según lo que contenga la URL, igual que hace el
// servidor real.
function fakeIgdbFetch({ games, timeToBeat }) {
  return async (url) => {
    const s = String(url);
    if (s.includes('oauth2/token')) {
      return { ok: true, status: 200, json: async () => ({ access_token: 'tok', expires_in: 3600 }) };
    }
    if (s.includes('v4/games')) {
      return { ok: true, status: 200, json: async () => games };
    }
    if (s.includes('game_time_to_beats')) {
      return { ok: true, status: 200, json: async () => timeToBeat };
    }
    throw new Error(`fetch inesperado a ${s}`);
  };
}

test('POST /api/games/:id/igdb/search busca en IGDB y guarda el mejor match', async () => {
  const fetchImpl = fakeIgdbFetch({
    games: [{ id: 1, name: 'Hollow Knight' }],
    timeToBeat: [{ game_id: 1, hastily: 27000, completely: 90000 }],
  });

  await withTwitchEnv('CID', 'CSECRET', () =>
    withServer(async (base) => {
      const game = await (await postJson(base, '/api/games', { title: 'Hollow Knight', platform: 'PC' })).json();

      const res = await fetch(`${base}/api/games/${game.id}/igdb/search`, { method: 'POST' });
      assert.equal(res.status, 200);
      const updated = await res.json();
      assert.equal(updated.igdbId, 1);
      assert.equal(updated.igdbMainMinutes, 450);
      assert.equal(updated.igdbCompletionistMinutes, 1500);
    }, { fetchImpl })
  );
});

test('POST /api/games/:id/igdb/search da 404 si no hay resultados', async () => {
  const fetchImpl = fakeIgdbFetch({ games: [], timeToBeat: [] });

  await withTwitchEnv('CID', 'CSECRET', () =>
    withServer(async (base) => {
      const game = await (await postJson(base, '/api/games', { title: 'Juego rarísimo', platform: 'PC' })).json();
      const res = await fetch(`${base}/api/games/${game.id}/igdb/search`, { method: 'POST' });
      assert.equal(res.status, 404);
    }, { fetchImpl })
  );
});

test('POST /api/games/:id/igdb/search sin credenciales de Twitch da un error claro', async () => {
  const fetchImpl = fakeIgdbFetch({ games: [], timeToBeat: [] });

  await withTwitchEnv(undefined, undefined, () =>
    withServer(async (base) => {
      const game = await (await postJson(base, '/api/games', { title: 'Celeste', platform: 'PC' })).json();
      const res = await fetch(`${base}/api/games/${game.id}/igdb/search`, { method: 'POST' });
      assert.equal(res.status, 502);
      const body = await res.json();
      assert.match(body.error, /TWITCH_CLIENT_ID/);
    }, { fetchImpl })
  );
});

test('PATCH /api/games/:id/igdb corrige los tiempos a mano y conserva el igdbId ya guardado', async () => {
  const fetchImpl = fakeIgdbFetch({
    games: [{ id: 7, name: 'Celeste' }],
    timeToBeat: [{ game_id: 7, hastily: 18000, completely: 72000 }],
  });

  await withTwitchEnv('CID', 'CSECRET', () =>
    withServer(async (base) => {
      const game = await (await postJson(base, '/api/games', { title: 'Celeste', platform: 'PC' })).json();
      await postJson(base, `/api/games/${game.id}/igdb/search`, {});

      const patchRes = await fetch(`${base}/api/games/${game.id}/igdb`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mainMinutes: 300, completionistMinutes: 600 }),
      });
      assert.equal(patchRes.status, 200);
      const updated = await patchRes.json();
      assert.equal(updated.igdbMainMinutes, 300);
      assert.equal(updated.igdbCompletionistMinutes, 600);
      assert.equal(updated.igdbId, 7);
    }, { fetchImpl })
  );
});

test('POST /api/games/:id/igdb/search en juego inexistente da 404', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/games/999/igdb/search`, { method: 'POST' });
    assert.equal(res.status, 404);
  });
});
