// Cliente de la API privada del launcher de Epic Games (la misma que usan
// Legendary, Heroic, etc.). Igual que /sync con Steam: habla HTTP y
// traduce, sin saber nada de SQLite.
//
// No hay API pública ni cuenta de desarrollador: se usan las credenciales
// del propio launcher de Epic, que son públicas y están en todas las
// herramientas del ecosistema. El usuario solo aporta, una vez, un código
// de autorización de su cuenta (ver epic/run.js -> login).

const ACCOUNT_HOST = 'https://account-public-service-prod.ol.epicgames.com';
const LAUNCHER_HOST = 'https://launcher-public-service-prod06.ol.epicgames.com';
const CATALOG_HOST = 'https://catalog-public-service-prod06.ol.epicgames.com';
const LIBRARY_HOST = 'https://library-service.live.use1a.on.epicgames.com';

// Credenciales públicas del "Epic Games Launcher".
const CLIENT_ID = '34a02cf8f4414e29b15921876da36f9a';
const CLIENT_SECRET = 'daafbccc737745039dffe53d94fc76cf';
const BASIC_AUTH = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');

async function oauthToken(params, { fetchImpl = fetch } = {}) {
  const res = await fetchImpl(`${ACCOUNT_HOST}/account/api/oauth/token`, {
    method: 'POST',
    headers: {
      Authorization: `basic ${BASIC_AUTH}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ token_type: 'eg1', ...params }).toString(),
  });

  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = body?.errorMessage || body?.error_description || `HTTP ${res.status}`;
    throw new Error(`Epic OAuth: ${msg}`);
  }

  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    accountId: body.account_id,
    // expires_at viene en ISO; se guarda como epoch ms con 60s de margen.
    expiresAt: new Date(body.expires_at).getTime() - 60_000,
  };
}

// Canjea el código de autorización (de un solo uso, caduca en minutos) por
// un par de tokens.
function exchangeAuthCode(code, opts = {}) {
  return oauthToken({ grant_type: 'authorization_code', code }, opts);
}

// Renueva con el refresh token. Epic devuelve uno nuevo cada vez, así que
// hay que volver a guardarlo.
function refreshAccessToken(refreshToken, opts = {}) {
  return oauthToken({ grant_type: 'refresh_token', refresh_token: refreshToken }, opts);
}

async function epicGet(url, accessToken, { fetchImpl = fetch } = {}) {
  const res = await fetchImpl(url, { headers: { Authorization: `bearer ${accessToken}` } });
  if (!res.ok) throw new Error(`Epic API respondió ${res.status} en ${new URL(url).pathname}`);
  return res.json();
}

// Horas jugadas por juego. artifactId coincide con el appName del catálogo.
// totalTime viene en segundos.
async function fetchPlaytime(accountId, accessToken, opts = {}) {
  const rows = await epicGet(
    `${LIBRARY_HOST}/library/api/public/playtime/account/${accountId}/all`,
    accessToken,
    opts
  );
  return (rows || []).map((r) => ({
    artifactId: r.artifactId,
    minutes: Math.round((r.totalTime || 0) / 60),
  }));
}

// Todo lo que la cuenta "posee" para Windows (juegos, pero también motores
// y herramientas). Se indexa por appName para cruzarlo con el playtime.
async function fetchOwnedAssets(accessToken, opts = {}) {
  const rows = await epicGet(
    `${LAUNCHER_HOST}/launcher/api/public/assets/Windows?label=Live`,
    accessToken,
    opts
  );
  const byAppName = {};
  for (const a of rows || []) {
    byAppName[a.appName] = { catalogItemId: a.catalogItemId, namespace: a.namespace };
  }
  return byAppName;
}

function pickImage(keyImages = []) {
  const order = ['DieselStoreFrontTall', 'OfferImageTall', 'Thumbnail', 'DieselStoreFrontWide', 'OfferImageWide'];
  for (const type of order) {
    const hit = keyImages.find((k) => k.type === type && k.url);
    if (hit) return hit.url;
  }
  return keyImages[0]?.url || null;
}

// Metadatos de un producto del catálogo: título, imagen y si es un juego
// (frente a DLC, app, motor...).
async function fetchCatalogItem(namespace, catalogItemId, accessToken, opts = {}) {
  const url =
    `${CATALOG_HOST}/catalog/api/shared/namespace/${namespace}/bulk/items` +
    `?id=${catalogItemId}&country=US&locale=en-US&includeMainGameDetails=true`;
  const body = await epicGet(url, accessToken, opts);
  const item = body?.[catalogItemId];
  if (!item) return null;

  const paths = (item.categories || []).map((c) => c.path);
  return {
    title: item.title,
    iconUrl: pickImage(item.keyImages),
    isGame: paths.includes('games') && !paths.includes('addons'),
  };
}

module.exports = {
  exchangeAuthCode,
  refreshAccessToken,
  fetchPlaytime,
  fetchOwnedAssets,
  fetchCatalogItem,
  CLIENT_ID,
};
