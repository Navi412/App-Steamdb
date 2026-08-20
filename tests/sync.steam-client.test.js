const test = require('node:test');
const assert = require('node:assert/strict');
const { fetchOwnedGames, fetchPlayerAchievements, OWNED_GAMES_URL, PLAYER_ACHIEVEMENTS_URL } = require('../sync/steam-client');

function fakeFetch(response, { ok = true, status = 200 } = {}) {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    return { ok, status, json: async () => response };
  };
  fetchImpl.calls = calls;
  return fetchImpl;
}

test('construye la URL con key, steamid y flags esperados', async () => {
  const fetchImpl = fakeFetch({ response: { games: [] } });
  await fetchOwnedGames({ apiKey: 'KEY123', steamId: '765611', fetchImpl });

  const url = fetchImpl.calls[0];
  assert.equal(url.origin + url.pathname, OWNED_GAMES_URL);
  assert.equal(url.searchParams.get('key'), 'KEY123');
  assert.equal(url.searchParams.get('steamid'), '765611');
  assert.equal(url.searchParams.get('include_appinfo'), 'true');
});

test('devuelve el JSON parseado tal cual', async () => {
  const payload = { response: { games: [{ appid: 1 }] } };
  const fetchImpl = fakeFetch(payload);
  const result = await fetchOwnedGames({ apiKey: 'K', steamId: 'S', fetchImpl });
  assert.deepEqual(result, payload);
});

test('lanza si la API responde con error HTTP', async () => {
  const fetchImpl = fakeFetch({}, { ok: false, status: 403 });
  await assert.rejects(
    () => fetchOwnedGames({ apiKey: 'K', steamId: 'S', fetchImpl }),
    /403/
  );
});

test('lanza si falta apiKey o steamId', async () => {
  await assert.rejects(() => fetchOwnedGames({ steamId: 'S', fetchImpl: fakeFetch({}) }));
  await assert.rejects(() => fetchOwnedGames({ apiKey: 'K', fetchImpl: fakeFetch({}) }));
});

test('fetchPlayerAchievements construye la URL con appid', async () => {
  const fetchImpl = fakeFetch({ playerstats: { success: true, achievements: [] } });
  await fetchPlayerAchievements({ apiKey: 'K', steamId: 'S', appId: 620, fetchImpl });

  const url = fetchImpl.calls[0];
  assert.equal(url.origin + url.pathname, PLAYER_ACHIEVEMENTS_URL);
  assert.equal(url.searchParams.get('appid'), '620');
  assert.equal(url.searchParams.get('l'), 'spanish');
});

test('fetchPlayerAchievements devuelve el cuerpo aunque el status sea de error (juego sin logros)', async () => {
  const fetchImpl = fakeFetch({ playerstats: { success: false, error: 'Requested app has no stats' } }, { ok: false, status: 400 });
  const result = await fetchPlayerAchievements({ apiKey: 'K', steamId: 'S', appId: 620, fetchImpl });
  assert.equal(result.playerstats.success, false);
});

test('fetchPlayerAchievements lanza si el cuerpo no es interpretable', async () => {
  const fetchImpl = async () => ({ ok: false, status: 500, json: async () => { throw new Error('no es JSON'); } });
  await assert.rejects(() => fetchPlayerAchievements({ apiKey: 'K', steamId: 'S', appId: 620, fetchImpl }), /500/);
});

test('fetchPlayerAchievements lanza si falta appId', async () => {
  await assert.rejects(() => fetchPlayerAchievements({ apiKey: 'K', steamId: 'S', fetchImpl: fakeFetch({}) }));
});
