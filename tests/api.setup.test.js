const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createServer } = require('../api/server');
const { readEnv } = require('../setup/env-file');

function tempDbPath() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'steamdb-setup-api-test-')), 'test.sqlite');
}
function tempEnvPath() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'steamdb-setup-api-test-env-')), '.env');
}
function tempEpicAuthPath() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'steamdb-setup-api-test-epic-')), 'epic_auth.json');
}

async function withServer(fn, { fetchImpl, envPath = tempEnvPath(), epicAuthPath = tempEpicAuthPath() } = {}) {
  process.env.DB_PATH = tempDbPath();
  const server = createServer({ fetchImpl, envPath, epicAuthPath });
  await new Promise((resolve) => server.listen(0, resolve));
  const base = `http://localhost:${server.address().port}`;
  try {
    await fn(base, { envPath, epicAuthPath });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function fakeFetch(responses) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), options });
    const entry = responses.find((r) => String(url).includes(r.urlIncludes));
    if (!entry) throw new Error(`fetch inesperado a ${url}`);
    return { ok: entry.ok ?? true, status: entry.status ?? 200, json: async () => entry.body };
  };
  fetchImpl.calls = calls;
  return fetchImpl;
}

// Guarda /api/setup/save toca process.env de verdad (para que /api/sync lo
// vea al momento); hay que devolverlo a como estaba al terminar cada test.
async function withCleanEnv(keys, fn) {
  const prev = {};
  for (const k of keys) prev[k] = process.env[k];
  try {
    await fn();
  } finally {
    for (const k of keys) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
  }
}

test('GET /api/setup/fields expone los grupos declarados en setup/fields.js', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/setup/fields`);
    assert.equal(res.status, 200);
    const body = await res.json();
    const steam = body.groups.find((g) => g.id === 'steam');
    assert.ok(steam);
    assert.equal(steam.required, true);
    assert.ok(steam.fields.some((f) => f.key === 'STEAM_API_KEY'));
  });
});

test('GET /api/setup/status dice qué hay guardado, enmascarando lo secreto', async () => {
  await withCleanEnv(['STEAM_API_KEY', 'STEAM_ID'], async () => {
    await withServer(async (base) => {
      const before = await fetch(`${base}/api/setup/status`).then((r) => r.json());
      assert.equal(before.values.STEAM_API_KEY.filled, false);
      assert.equal(before.epic.ok, false);

      await fetch(`${base}/api/setup/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ values: { STEAM_API_KEY: 'ABCD1234EFGH5678', STEAM_ID: '76561198000000000' } }),
      });

      const after = await fetch(`${base}/api/setup/status`).then((r) => r.json());
      assert.equal(after.values.STEAM_API_KEY.filled, true);
      assert.match(after.values.STEAM_API_KEY.display, /^\*+5678$/);
      assert.equal(after.values.STEAM_ID.display, '76561198000000000'); // no es secreto: se ve entero
    });
  });
});

test('POST /api/setup/save escribe en el .env indicado y lo dispone en process.env', async () => {
  await withCleanEnv(['STEAM_API_KEY'], async () => {
    await withServer(async (base, { envPath }) => {
      const res = await fetch(`${base}/api/setup/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ values: { STEAM_API_KEY: 'MIALIVE' } }),
      });
      assert.equal(res.status, 200);
      assert.equal(readEnv(envPath).STEAM_API_KEY, 'MIALIVE');
      assert.equal(process.env.STEAM_API_KEY, 'MIALIVE');
    });
  });
});

test('POST /api/setup/save no borra una clave existente si no se manda', async () => {
  await withCleanEnv(['STEAM_API_KEY', 'STEAM_ID'], async () => {
    await withServer(async (base) => {
      await fetch(`${base}/api/setup/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ values: { STEAM_API_KEY: 'KEY1STEAMVALUE', STEAM_ID: '76561198000000000' } }),
      });
      await fetch(`${base}/api/setup/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ values: { STEAM_ID: '76561198000000001' } }),
      });
      const status = await fetch(`${base}/api/setup/status`).then((r) => r.json());
      assert.equal(status.values.STEAM_ID.display, '76561198000000001');
      assert.match(status.values.STEAM_API_KEY.display, /ALUE$/);
    });
  });
});

test('POST /api/setup/validate (steam) resuelve el vanity y valida contra la API', async () => {
  await withCleanEnv([], async () => {
    const fetchImpl = fakeFetch([
      { urlIncludes: 'ResolveVanityURL', body: { response: { success: 1, steamid: '76561198000000000' } } },
      { urlIncludes: 'GetOwnedGames', body: { response: { game_count: 3, games: [] } } },
    ]);
    await withServer(
      async (base) => {
        const res = await fetch(`${base}/api/setup/validate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ groupId: 'steam', values: { STEAM_API_KEY: 'KEY', STEAM_ID: 'gaben' } }),
        });
        const body = await res.json();
        assert.equal(body.ok, true);
        assert.equal(body.steamId, '76561198000000000');
        assert.match(body.detail, /3 juegos/);
      },
      { fetchImpl }
    );
  });
});

test('POST /api/setup/validate (steam) devuelve el error de la API sin guardar nada', async () => {
  await withCleanEnv([], async () => {
    const fetchImpl = fakeFetch([{ urlIncludes: 'GetOwnedGames', ok: false, status: 403, body: {} }]);
    await withServer(
      async (base) => {
        const res = await fetch(`${base}/api/setup/validate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ groupId: 'steam', values: { STEAM_API_KEY: 'MALA', STEAM_ID: '76561198000000000' } }),
        });
        const body = await res.json();
        assert.equal(body.ok, false);
        assert.ok(body.error);
      },
      { fetchImpl }
    );
  });
});

test('POST /api/setup/epic/redeem canjea el código pegado (JSON entero o suelto) y guarda la sesión', async () => {
  const fetchImpl = fakeFetch([
    {
      urlIncludes: 'oauth/token',
      body: {
        access_token: 'at',
        refresh_token: 'rt',
        account_id: 'acc9',
        expires_at: new Date(Date.now() + 3600_000).toISOString(),
      },
    },
  ]);
  await withServer(
    async (base, { epicAuthPath }) => {
      const res = await fetch(`${base}/api/setup/epic/redeem`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: '{"authorizationCode":"CODIGO1234567890","sid":"x"}' }),
      });
      const body = await res.json();
      assert.equal(body.ok, true);
      assert.match(body.detail, /acc9/);
      assert.equal(JSON.parse(fs.readFileSync(epicAuthPath, 'utf8')).refreshToken, 'rt');
    },
    { fetchImpl }
  );
});

test('POST /api/setup/epic/redeem sin texto da 400', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/setup/epic/redeem`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: '   ' }),
    });
    assert.equal(res.status, 400);
  });
});
