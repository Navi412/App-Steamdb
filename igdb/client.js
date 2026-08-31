// Cliente de la API de IGDB (api.igdb.com, propiedad de Twitch). Igual que
// /sync con Steam: sabe hablar HTTP y traducir la respuesta a datos
// simples, sin saber nada de SQLite ni de qué juego de nuestra base de
// datos se está buscando.
//
// Se eligió IGDB en vez de hablar directamente con howlongtobeat.com
// porque esta última puso una barrera anti-bot (token + honeypot) delante
// de su buscador. IGDB expone el mismo dato ("Game Time To Beat") con una
// API oficial, documentada, gratuita y sin protección anti-scraping —
// solo requiere una app de Twitch (Client ID + Client Secret) y OAuth de
// client credentials.

const TOKEN_URL = 'https://id.twitch.tv/oauth2/token';
const GAMES_URL = 'https://api.igdb.com/v4/games';
const TIME_TO_BEAT_URL = 'https://api.igdb.com/v4/game_time_to_beats';

// El token de Twitch dura semanas (no minutos como un JWT típico), así que
// merece la pena cachearlo en memoria del proceso en vez de pedirlo en
// cada búsqueda.
let cachedToken = null;

async function getAccessToken({ clientId, clientSecret, fetchImpl = fetch } = {}) {
  if (!clientId) throw new Error('TWITCH_CLIENT_ID no configurada');
  if (!clientSecret) throw new Error('TWITCH_CLIENT_SECRET no configurada');

  if (cachedToken && cachedToken.expiresAt > Date.now()) {
    return cachedToken.accessToken;
  }

  const url = new URL(TOKEN_URL);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('client_secret', clientSecret);
  url.searchParams.set('grant_type', 'client_credentials');

  const res = await fetchImpl(url, { method: 'POST' });
  if (!res.ok) throw new Error(`Twitch OAuth respondió ${res.status}`);
  const body = await res.json();

  // Margen de 60s para no arriesgarse a usar el token justo cuando caduca.
  cachedToken = { accessToken: body.access_token, expiresAt: Date.now() + (body.expires_in - 60) * 1000 };
  return cachedToken.accessToken;
}

async function igdbRequest(url, body, { clientId, clientSecret, fetchImpl = fetch } = {}) {
  const token = await getAccessToken({ clientId, clientSecret, fetchImpl });
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: {
      'Client-ID': clientId,
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
    body,
  });
  if (!res.ok) throw new Error(`IGDB API respondió ${res.status}`);
  return res.json();
}

function secondsToMinutes(seconds) {
  return typeof seconds === 'number' && seconds > 0 ? Math.round(seconds / 60) : null;
}

async function searchGame(title, { clientId, clientSecret, fetchImpl = fetch } = {}) {
  if (!title || !title.trim()) throw new Error('title es obligatorio');

  const escaped = title.trim().replace(/"/g, '\\"');
  const games = await igdbRequest(
    GAMES_URL,
    `search "${escaped}"; fields id,name; limit 20;`,
    { clientId, clientSecret, fetchImpl }
  );

  return games.map((g) => ({ igdbId: g.id, title: g.name }));
}

// hastily/completely son los nombres de campo de IGDB: "hastily" es el
// tiempo para acabar la campaña sin dedicarle tiempo a extras (equivalente
// a "Main Story" de HowLongToBeat), "completely" es el 100% ("Completionist").
async function getTimeToBeat(igdbId, { clientId, clientSecret, fetchImpl = fetch } = {}) {
  const rows = await igdbRequest(
    TIME_TO_BEAT_URL,
    `where game_id = ${Number(igdbId)}; fields hastily,completely;`,
    { clientId, clientSecret, fetchImpl }
  );

  const row = rows[0];
  return {
    mainMinutes: row ? secondsToMinutes(row.hastily) : null,
    completionistMinutes: row ? secondsToMinutes(row.completely) : null,
  };
}

module.exports = { getAccessToken, searchGame, getTimeToBeat, TOKEN_URL, GAMES_URL, TIME_TO_BEAT_URL };
