const test = require('node:test');
const assert = require('node:assert/strict');
const {
  exchangeAuthCode,
  refreshAccessToken,
  fetchPlaytime,
  fetchOwnedAssets,
  fetchCatalogItem,
} = require('../epic/client');

function fakeFetch(routes) {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    const entry = Object.entries(routes).find(([frag]) => String(url).includes(frag));
    if (!entry) throw new Error(`fetch inesperado a ${url}`);
    const r = entry[1];
    return { ok: r.ok ?? true, status: r.status ?? 200, json: async () => r.body };
  };
  fetchImpl.calls = calls;
  return fetchImpl;
}

const TOKEN_BODY = {
  access_token: 'AT',
  refresh_token: 'RT2',
  account_id: 'acc-1',
  expires_at: '2099-01-01T00:00:00.000Z',
};

test('exchangeAuthCode manda grant_type=authorization_code y Basic auth, y aplana el token', async () => {
  const fetchImpl = fakeFetch({ '/account/api/oauth/token': { body: TOKEN_BODY } });

  const token = await exchangeAuthCode('the-code', { fetchImpl });
  assert.deepEqual(token, {
    accessToken: 'AT',
    refreshToken: 'RT2',
    accountId: 'acc-1',
    expiresAt: new Date('2099-01-01T00:00:00.000Z').getTime() - 60_000,
  });

  const { options } = fetchImpl.calls[0];
  assert.match(options.headers.Authorization, /^basic [A-Za-z0-9+/=]+$/);
  assert.match(options.body, /grant_type=authorization_code/);
  assert.match(options.body, /code=the-code/);
});

test('refreshAccessToken usa grant_type=refresh_token', async () => {
  const fetchImpl = fakeFetch({ '/oauth/token': { body: TOKEN_BODY } });
  await refreshAccessToken('RT1', { fetchImpl });
  assert.match(fetchImpl.calls[0].options.body, /grant_type=refresh_token/);
  assert.match(fetchImpl.calls[0].options.body, /refresh_token=RT1/);
});

test('el OAuth propaga el mensaje de error de Epic', async () => {
  const fetchImpl = fakeFetch({
    '/oauth/token': { ok: false, status: 400, body: { errorMessage: 'código caducado' } },
  });
  await assert.rejects(() => refreshAccessToken('x', { fetchImpl }), /código caducado/);
});

test('fetchPlaytime pasa el bearer y convierte totalTime (segundos) a minutos', async () => {
  const fetchImpl = fakeFetch({
    '/playtime/account/acc-1/all': {
      body: [
        { artifactId: 'Fortnite', totalTime: 7200 },
        { artifactId: 'AlanWake', totalTime: 5430 },
      ],
    },
  });

  const rows = await fetchPlaytime('acc-1', 'AT', { fetchImpl });
  assert.deepEqual(rows, [
    { artifactId: 'Fortnite', minutes: 120 },
    { artifactId: 'AlanWake', minutes: 91 },
  ]);
  assert.equal(fetchImpl.calls[0].options.headers.Authorization, 'bearer AT');
});

test('fetchOwnedAssets indexa por appName', async () => {
  const fetchImpl = fakeFetch({
    '/launcher/api/public/assets/Windows': {
      body: [
        { appName: 'AlanWake', catalogItemId: 'cat-1', namespace: 'ns-1' },
        { appName: 'UE_4.27', catalogItemId: 'cat-2', namespace: 'ue' },
      ],
    },
  });

  const assets = await fetchOwnedAssets('AT', { fetchImpl });
  assert.deepEqual(assets.AlanWake, { catalogItemId: 'cat-1', namespace: 'ns-1' });
});

test('fetchCatalogItem saca título, imagen vertical y marca isGame', async () => {
  const fetchImpl = fakeFetch({
    '/catalog/api/shared/namespace/ns-1/bulk/items': {
      body: {
        'cat-1': {
          title: 'Alan Wake',
          keyImages: [
            { type: 'DieselStoreFrontWide', url: 'http://img/wide.jpg' },
            { type: 'DieselStoreFrontTall', url: 'http://img/tall.jpg' },
          ],
          categories: [{ path: 'games' }, { path: 'applications' }],
        },
      },
    },
  });

  const meta = await fetchCatalogItem('ns-1', 'cat-1', 'AT', { fetchImpl });
  assert.deepEqual(meta, { title: 'Alan Wake', iconUrl: 'http://img/tall.jpg', isGame: true });
});

test('fetchCatalogItem marca isGame=false para un DLC (categoría addons)', async () => {
  const fetchImpl = fakeFetch({
    '/bulk/items': {
      body: { 'cat-9': { title: 'DLC X', keyImages: [], categories: [{ path: 'games' }, { path: 'addons' }] } },
    },
  });
  const meta = await fetchCatalogItem('ns', 'cat-9', 'AT', { fetchImpl });
  assert.equal(meta.isGame, false);
});
