const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

// validate.js y el cliente de IGDB cachean cosas en memoria de módulo; se
// recargan por test para que no hereden estado entre casos.
function freshValidate() {
  for (const p of [require.resolve('../setup/validate'), require.resolve('../igdb/client')]) {
    delete require.cache[p];
  }
  return require('../setup/validate');
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

// ── resolveSteamId ─────────────────────────────────────────────────────
test('resolveSteamId acepta un SteamID64 de 17 dígitos sin llamar a la red', async () => {
  const { resolveSteamId } = freshValidate();
  const r = await resolveSteamId('76561198000000000', { fetchImpl: () => assert.fail('no debería llamar') });
  assert.deepEqual(r, { steamId: '76561198000000000' });
});

test('resolveSteamId saca el id de una URL /profiles/', async () => {
  const { resolveSteamId } = freshValidate();
  const r = await resolveSteamId('https://steamcommunity.com/profiles/76561198000000001/', {
    fetchImpl: () => assert.fail('no debería llamar'),
  });
  assert.deepEqual(r, { steamId: '76561198000000001' });
});

test('resolveSteamId resuelve un nombre personalizado vía ResolveVanityURL', async () => {
  const { resolveSteamId } = freshValidate();
  const fetchImpl = fakeFetch([
    { urlIncludes: 'ResolveVanityURL', body: { response: { success: 1, steamid: '76561198000000002' } } },
  ]);
  const r = await resolveSteamId('gaben', { apiKey: 'KEY', fetchImpl });
  assert.deepEqual(r, { steamId: '76561198000000002' });
  assert.match(fetchImpl.calls[0].url, /vanityurl=gaben/);
});

test('resolveSteamId resuelve también una URL /id/nombre', async () => {
  const { resolveSteamId } = freshValidate();
  const fetchImpl = fakeFetch([
    { urlIncludes: 'ResolveVanityURL', body: { response: { success: 1, steamid: '76561198000000003' } } },
  ]);
  const r = await resolveSteamId('https://steamcommunity.com/id/gaben', { apiKey: 'KEY', fetchImpl });
  assert.equal(r.steamId, '76561198000000003');
  assert.match(fetchImpl.calls[0].url, /vanityurl=gaben/);
});

test('resolveSteamId devuelve error si el nombre no existe', async () => {
  const { resolveSteamId } = freshValidate();
  const fetchImpl = fakeFetch([
    { urlIncludes: 'ResolveVanityURL', body: { response: { success: 42, message: 'No match' } } },
  ]);
  const r = await resolveSteamId('nadie', { apiKey: 'KEY', fetchImpl });
  assert.equal(r.steamId, undefined);
  assert.match(r.error, /No match/);
});

test('resolveSteamId pide una API key para resolver un nombre suelto', async () => {
  const { resolveSteamId } = freshValidate();
  const r = await resolveSteamId('gaben', {});
  assert.match(r.error, /STEAM_API_KEY/);
});

// ── validateSteam ──────────────────────────────────────────────────────
test('validateSteam ok informa del número de juegos', async () => {
  const { validateSteam } = freshValidate();
  const fetchImpl = fakeFetch([
    { urlIncludes: 'GetOwnedGames', body: { response: { game_count: 214, games: [] } } },
  ]);
  const r = await validateSteam({ apiKey: 'KEY', steamId: '76561198000000000', fetchImpl });
  assert.equal(r.ok, true);
  assert.match(r.detail, /214 juegos/);
});

test('validateSteam trata una respuesta vacía como perfil privado / SteamID malo', async () => {
  const { validateSteam } = freshValidate();
  const fetchImpl = fakeFetch([{ urlIncludes: 'GetOwnedGames', body: { response: {} } }]);
  const r = await validateSteam({ apiKey: 'KEY', steamId: '76561198000000000', fetchImpl });
  assert.equal(r.ok, false);
  assert.match(r.error, /p[úu]blic/i);
});

test('validateSteam propaga como error un 403 de Steam (clave inválida)', async () => {
  const { validateSteam } = freshValidate();
  const fetchImpl = fakeFetch([{ urlIncludes: 'GetOwnedGames', ok: false, status: 403, body: {} }]);
  const r = await validateSteam({ apiKey: 'MALA', steamId: '76561198000000000', fetchImpl });
  assert.equal(r.ok, false);
  assert.match(r.error, /403/);
});

// ── validateIgdb ───────────────────────────────────────────────────────
test('validateIgdb ok cuando Twitch entrega un token', async () => {
  const { validateIgdb } = freshValidate();
  const fetchImpl = fakeFetch([
    { urlIncludes: 'oauth2/token', body: { access_token: 'tok', expires_in: 5000000 } },
  ]);
  const r = await validateIgdb({ clientId: 'CID', clientSecret: 'CS', fetchImpl });
  assert.equal(r.ok, true);
});

test('validateIgdb falla cuando Twitch rechaza las credenciales', async () => {
  const { validateIgdb } = freshValidate();
  const fetchImpl = fakeFetch([{ urlIncludes: 'oauth2/token', ok: false, status: 403, body: {} }]);
  const r = await validateIgdb({ clientId: 'CID', clientSecret: 'MALO', fetchImpl });
  assert.equal(r.ok, false);
  assert.match(r.error, /403/);
});

// ── validateOpenXbl ────────────────────────────────────────────────────
test('validateOpenXbl ok saca el gamertag del perfil', async () => {
  const { validateOpenXbl } = freshValidate();
  const fetchImpl = fakeFetch([
    {
      urlIncludes: 'xbl.io/api/v2/account',
      body: { profileUsers: [{ settings: [{ id: 'Gamertag', value: 'MiGamertag' }] }] },
    },
  ]);
  const r = await validateOpenXbl({ apiKey: 'KEY', fetchImpl });
  assert.equal(r.ok, true);
  assert.match(r.detail, /MiGamertag/);
  assert.equal(fetchImpl.calls[0].options.headers['X-Authorization'], 'KEY');
});

test('validateOpenXbl falla con un 403', async () => {
  const { validateOpenXbl } = freshValidate();
  const fetchImpl = fakeFetch([{ urlIncludes: 'xbl.io/api/v2/account', ok: false, status: 403, body: {} }]);
  const r = await validateOpenXbl({ apiKey: 'MALA', fetchImpl });
  assert.equal(r.ok, false);
  assert.match(r.error, /403/);
});

test('validateOpenXbl sin key no llama a la red', async () => {
  const { validateOpenXbl } = freshValidate();
  const r = await validateOpenXbl({ apiKey: '', fetchImpl: () => assert.fail('no debería llamar') });
  assert.equal(r.ok, false);
});

// ── Epic ───────────────────────────────────────────────────────────────
test('validateEpic falla limpio si no hay sesión guardada', async () => {
  const { validateEpic } = freshValidate();
  const authPath = path.join(os.tmpdir(), `steamdb-epic-noexiste-${Date.now()}.json`);
  const r = await validateEpic({ authPath, fetchImpl: () => assert.fail('no debería llamar') });
  assert.equal(r.ok, false);
  assert.match(r.error, /sin sesi[óo]n/i);
});

test('validateEpic refresca la sesión, reescribe el refresh token y cuenta juegos', async () => {
  const { validateEpic } = freshValidate();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'steamdb-epic-'));
  const authPath = path.join(dir, 'epic_auth.json');
  fs.writeFileSync(authPath, JSON.stringify({ refreshToken: 'viejo', accountId: 'acc1' }));

  const fetchImpl = fakeFetch([
    {
      urlIncludes: 'oauth/token',
      body: {
        access_token: 'at',
        refresh_token: 'nuevo',
        account_id: 'acc1',
        expires_at: new Date(Date.now() + 3600_000).toISOString(),
      },
    },
    { urlIncludes: '/playtime/account/', body: [{ artifactId: 'a', totalTime: 3600 }, { artifactId: 'b', totalTime: 60 }] },
  ]);

  const r = await validateEpic({ authPath, fetchImpl });
  assert.equal(r.ok, true);
  assert.match(r.detail, /2 juegos/);
  assert.equal(JSON.parse(fs.readFileSync(authPath, 'utf8')).refreshToken, 'nuevo');

  fs.rmSync(dir, { recursive: true, force: true });
});

test('activateEpic canjea el código y guarda la sesión', async () => {
  const { activateEpic } = freshValidate();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'steamdb-epic-'));
  const authPath = path.join(dir, 'epic_auth.json');

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

  const r = await activateEpic('CODIGO', { authPath, fetchImpl });
  assert.equal(r.ok, true);
  assert.match(r.detail, /acc9/);
  assert.equal(JSON.parse(fs.readFileSync(authPath, 'utf8')).refreshToken, 'rt');

  fs.rmSync(dir, { recursive: true, force: true });
});

// ── validateGog / validateEden ────────────────────────────────────────
// Ninguna de las dos pide credenciales: solo confirman que Galaxy/Eden
// dejaron sus datos en el disco (ver setup/validate.js).
test('validateGog ok cuenta los juegos si la base de Galaxy existe', async () => {
  const { validateGog } = freshValidate();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'steamdb-gog-validate-'));
  const dbPath = path.join(dir, 'galaxy-2.0.db');
  const db = new DatabaseSync(dbPath);
  db.exec('CREATE TABLE LibraryReleases (id INTEGER PRIMARY KEY, userId INTEGER, releaseKey TEXT);');
  db.close();

  const r = validateGog({ dbPath });
  assert.equal(r.ok, true);
  assert.match(r.detail, /0 juegos/);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('validateGog falla limpio (con el mismo error que el sync) si no hay Galaxy instalado', async () => {
  const { validateGog } = freshValidate();
  const dbPath = path.join(os.tmpdir(), `steamdb-gog-noexiste-${Date.now()}.db`);
  const r = validateGog({ dbPath });
  assert.equal(r.ok, false);
  assert.match(r.error, /no se encontr[óo] la base de GOG Galaxy/);
});

test('validateEden ok cuenta los juegos si la carpeta de datos de Eden existe', async () => {
  const { validateEden } = freshValidate();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'steamdb-eden-validate-'));

  const r = validateEden({ dataDir });
  assert.equal(r.ok, true);
  assert.match(r.detail, /0 juegos/);

  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('validateEden falla limpio si no hay carpeta de datos de Eden', async () => {
  const { validateEden } = freshValidate();
  const dataDir = path.join(os.tmpdir(), `steamdb-eden-noexiste-${Date.now()}`);
  const r = validateEden({ dataDir });
  assert.equal(r.ok, false);
  assert.match(r.error, /no se encontr[óo] la carpeta de datos de Eden/);
});
