const test = require('node:test');
const assert = require('node:assert/strict');
const { fetchOwnedGames, OWNED_GAMES_URL } = require('../sync/steam-client');

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
