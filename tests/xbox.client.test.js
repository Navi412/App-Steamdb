const test = require('node:test');
const assert = require('node:assert/strict');
const { fetchPlayedTitles, fetchMinutesPlayed } = require('../xbox/client');

function fakeFetch(byPath) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), options });
    const entry = Object.entries(byPath).find(([frag]) => String(url).includes(frag));
    if (!entry) throw new Error(`fetch inesperado a ${url}`);
    const r = entry[1];
    return { ok: r.ok ?? true, status: r.status ?? 200, json: async () => r.body };
  };
  fetchImpl.calls = calls;
  return fetchImpl;
}

test('fetchPlayedTitles manda la API key en X-Authorization y aplana el historial', async () => {
  const fetchImpl = fakeFetch({
    '/player/titleHistory': {
      body: {
        content: {
          titles: [
            {
              titleId: 1670311038,
              name: 'Persona 3 Reload',
              type: 'Game',
              displayImage: 'http://img/p3.png',
              gamePass: { isGamePass: false },
              titleHistory: { lastTimePlayed: '2025-08-15T02:48:10.8Z' },
            },
            {
              titleId: 1794566092,
              name: 'Minecraft Launcher',
              type: 'Game',
              displayImage: 'http://img/mc.png',
              gamePass: { isGamePass: true },
              titleHistory: { lastTimePlayed: '2026-08-25T16:47:46.4Z' },
            },
            { titleId: 999, name: 'Netflix', type: 'App' },
          ],
        },
      },
    },
  });

  const titles = await fetchPlayedTitles({ apiKey: 'KEY', fetchImpl });

  assert.equal(fetchImpl.calls[0].options.headers['X-Authorization'], 'KEY');
  assert.deepEqual(titles, [
    {
      titleId: '1670311038',
      title: 'Persona 3 Reload',
      iconUrl: 'http://img/p3.png',
      isGamePass: false,
      lastPlayed: '2025-08-15T02:48:10.8Z',
    },
    {
      titleId: '1794566092',
      title: 'Minecraft Launcher',
      iconUrl: 'http://img/mc.png',
      isGamePass: true,
      lastPlayed: '2026-08-25T16:47:46.4Z',
    },
  ]);
});

test('fetchMinutesPlayed saca el stat MinutesPlayed', async () => {
  const fetchImpl = fakeFetch({
    '/achievements/stats/1670311038': {
      body: {
        content: {
          statlistscollection: [
            { arrangebyfield: 'xuid', stats: [{ name: 'MinutesPlayed', type: 'Integer', value: '5631' }] },
          ],
        },
      },
    },
  });

  assert.equal(await fetchMinutesPlayed('1670311038', { apiKey: 'K', fetchImpl }), 5631);
});

test('fetchMinutesPlayed da null si el título no tiene ese stat', async () => {
  const fetchImpl = fakeFetch({
    '/achievements/stats/': { body: { content: { statlistscollection: [{ stats: [] }] } } },
  });

  assert.equal(await fetchMinutesPlayed('123', { apiKey: 'K', fetchImpl }), null);
});

test('el cliente lanza sin API key y ante un error HTTP', async () => {
  await assert.rejects(() => fetchPlayedTitles({ fetchImpl: fakeFetch({}) }), /OPENXBL_API_KEY/);

  const failing = fakeFetch({ '/player/titleHistory': { ok: false, status: 429, body: {} } });
  await assert.rejects(() => fetchPlayedTitles({ apiKey: 'K', fetchImpl: failing }), /429/);
});
