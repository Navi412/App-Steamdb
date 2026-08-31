const test = require('node:test');
const assert = require('node:assert/strict');

const CLIENT_PATH = require.resolve('../igdb/client');

// El cliente cachea el token de Twitch en una variable de módulo. Para que
// los tests sean independientes entre sí (uno no debe heredar el token
// cacheado por el anterior), se recarga el módulo en cada test.
function freshClient() {
  delete require.cache[CLIENT_PATH];
  return require('../igdb/client');
}

function fakeFetch(responses) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), options });
    const entry = responses.find((r) => String(url).includes(r.urlIncludes));
    if (!entry) throw new Error(`fetch inesperado a ${url}`);
    return {
      ok: entry.ok ?? true,
      status: entry.status ?? 200,
      json: async () => entry.body,
    };
  };
  fetchImpl.calls = calls;
  return fetchImpl;
}

test('getAccessToken pide un token a Twitch con client_id, client_secret y grant_type', async () => {
  const { getAccessToken, TOKEN_URL } = freshClient();
  const fetchImpl = fakeFetch([{ urlIncludes: 'oauth2/token', body: { access_token: 'tok123', expires_in: 3600 } }]);

  const token = await getAccessToken({ clientId: 'CID', clientSecret: 'CSECRET', fetchImpl });
  assert.equal(token, 'tok123');

  const url = new URL(fetchImpl.calls[0].url);
  assert.equal(url.origin + url.pathname, TOKEN_URL);
  assert.equal(url.searchParams.get('client_id'), 'CID');
  assert.equal(url.searchParams.get('client_secret'), 'CSECRET');
  assert.equal(url.searchParams.get('grant_type'), 'client_credentials');
});

test('getAccessToken cachea el token y no vuelve a pedirlo mientras sea válido', async () => {
  const { getAccessToken } = freshClient();
  const fetchImpl = fakeFetch([{ urlIncludes: 'oauth2/token', body: { access_token: 'tok', expires_in: 3600 } }]);

  await getAccessToken({ clientId: 'C', clientSecret: 'S', fetchImpl });
  await getAccessToken({ clientId: 'C', clientSecret: 'S', fetchImpl });
  assert.equal(fetchImpl.calls.length, 1);
});

test('getAccessToken lanza si faltan credenciales', async () => {
  const { getAccessToken } = freshClient();
  await assert.rejects(
    () => getAccessToken({ clientSecret: 'S', fetchImpl: fakeFetch([]) }),
    /TWITCH_CLIENT_ID/
  );
  await assert.rejects(
    () => getAccessToken({ clientId: 'C', fetchImpl: fakeFetch([]) }),
    /TWITCH_CLIENT_SECRET/
  );
});

test('searchGame pide un token y busca en /games por título', async () => {
  const { searchGame } = freshClient();
  const fetchImpl = fakeFetch([
    { urlIncludes: 'oauth2/token', body: { access_token: 'tok', expires_in: 3600 } },
    { urlIncludes: 'v4/games', body: [{ id: 1, name: 'Hollow Knight' }, { id: 2, name: 'Hollow Knight: Silksong' }] },
  ]);

  const results = await searchGame('Hollow Knight', { clientId: 'C', clientSecret: 'S', fetchImpl });
  assert.deepEqual(results, [
    { igdbId: 1, title: 'Hollow Knight' },
    { igdbId: 2, title: 'Hollow Knight: Silksong' },
  ]);

  const gamesCall = fetchImpl.calls.find((c) => c.url.includes('v4/games'));
  assert.equal(gamesCall.options.headers['Client-ID'], 'C');
  assert.equal(gamesCall.options.headers.Authorization, 'Bearer tok');
  assert.match(gamesCall.options.body, /search "Hollow Knight"/);
});

test('searchGame lanza si el título está vacío', async () => {
  const { searchGame } = freshClient();
  await assert.rejects(() => searchGame('', { clientId: 'C', clientSecret: 'S', fetchImpl: fakeFetch([]) }));
});

test('getTimeToBeat traduce hastily/completely (segundos) a minutos', async () => {
  const { getTimeToBeat } = freshClient();
  const fetchImpl = fakeFetch([
    { urlIncludes: 'oauth2/token', body: { access_token: 'tok', expires_in: 3600 } },
    { urlIncludes: 'game_time_to_beats', body: [{ game_id: 1, hastily: 27000, completely: 90000 }] },
  ]);

  const times = await getTimeToBeat(1, { clientId: 'C', clientSecret: 'S', fetchImpl });
  assert.deepEqual(times, { mainMinutes: 450, completionistMinutes: 1500 });
});

test('getTimeToBeat descarta valores disparatados (basura de la comunidad) como null', async () => {
  const { getTimeToBeat } = freshClient();
  const fetchImpl = fakeFetch([
    { urlIncludes: 'oauth2/token', body: { access_token: 'tok', expires_in: 3600 } },
    // hastily = 72M s (~20.000 h): imposible. completely sí es plausible.
    { urlIncludes: 'game_time_to_beats', body: [{ game_id: 1, hastily: 72_000_000, completely: 90000 }] },
  ]);

  const times = await getTimeToBeat(1, { clientId: 'C', clientSecret: 'S', fetchImpl });
  assert.deepEqual(times, { mainMinutes: null, completionistMinutes: 1500 });
});

test('getTimeToBeat da minutos null si IGDB no tiene datos para ese juego', async () => {
  const { getTimeToBeat } = freshClient();
  const fetchImpl = fakeFetch([
    { urlIncludes: 'oauth2/token', body: { access_token: 'tok', expires_in: 3600 } },
    { urlIncludes: 'game_time_to_beats', body: [] },
  ]);

  const times = await getTimeToBeat(999, { clientId: 'C', clientSecret: 'S', fetchImpl });
  assert.deepEqual(times, { mainMinutes: null, completionistMinutes: null });
});

test('lanza si la API de IGDB responde con error HTTP', async () => {
  const { searchGame } = freshClient();
  const fetchImpl = fakeFetch([
    { urlIncludes: 'oauth2/token', body: { access_token: 'tok', expires_in: 3600 } },
    { urlIncludes: 'v4/games', ok: false, status: 500, body: {} },
  ]);

  await assert.rejects(() => searchGame('X', { clientId: 'C', clientSecret: 'S', fetchImpl }), /500/);
});
