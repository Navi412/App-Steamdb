const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createServer } = require('../api/server');

function tempDbPath() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'steamdb-sync-api-test-')), 'test.sqlite');
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

function withSteamEnv(apiKey, steamId, fn) {
  const prevKey = process.env.STEAM_API_KEY;
  const prevId = process.env.STEAM_ID;
  if (apiKey === undefined) delete process.env.STEAM_API_KEY;
  else process.env.STEAM_API_KEY = apiKey;
  if (steamId === undefined) delete process.env.STEAM_ID;
  else process.env.STEAM_ID = steamId;

  return fn().finally(() => {
    if (prevKey === undefined) delete process.env.STEAM_API_KEY;
    else process.env.STEAM_API_KEY = prevKey;
    if (prevId === undefined) delete process.env.STEAM_ID;
    else process.env.STEAM_ID = prevId;
  });
}

test('POST /api/sync sin credenciales configuradas da 500 con mensaje claro', async () => {
  await withSteamEnv(undefined, undefined, () =>
    withServer(async (base) => {
      const res = await fetch(`${base}/api/sync`, { method: 'POST' });
      assert.equal(res.status, 500);
      const body = await res.json();
      assert.match(body.error, /STEAM_API_KEY/);
    })
  );
});

test('POST /api/sync con credenciales sincroniza y actualiza la lista de juegos', async () => {
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ response: { games: [{ appid: 620, name: 'Portal 2', playtime_forever: 100 }] } }),
  });

  await withSteamEnv('K', 'S', () =>
    withServer(async (base) => {
      const res = await fetch(`${base}/api/sync`, { method: 'POST' });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.gamesSynced, 1);

      const games = await (await fetch(`${base}/api/games`)).json();
      assert.equal(games.length, 1);
      assert.equal(games[0].title, 'Portal 2');
    }, { fetchImpl })
  );
});

test('dos sincronizaciones a la vez: la segunda da 409 mientras la primera sigue en curso', async () => {
  let releaseFirst;
  const gate = new Promise((resolve) => { releaseFirst = resolve; });

  const fetchImpl = async () => {
    await gate;
    return { ok: true, status: 200, json: async () => ({ response: { games: [] } }) };
  };

  await withSteamEnv('K', 'S', () =>
    withServer(async (base) => {
      const first = fetch(`${base}/api/sync`, { method: 'POST' });
      await new Promise((resolve) => setTimeout(resolve, 50));

      const second = await fetch(`${base}/api/sync`, { method: 'POST' });
      assert.equal(second.status, 409);

      releaseFirst();
      const firstRes = await first;
      assert.equal(firstRes.status, 200);
    }, { fetchImpl })
  );
});
