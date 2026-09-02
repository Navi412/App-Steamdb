// Comprobaciones "en vivo" de cada credencial: tras pegar un valor en el
// wizard, se hace una llamada real a la API correspondiente para avisar de
// inmediato si algo está mal, antes de guardar el .env.
//
// Cada validador devuelve { ok: true, detail } o { ok: false, error } y
// NUNCA lanza por el caso esperado de "credencial incorrecta": ese es un
// resultado normal del wizard, no una excepción.

const { fetchOwnedGames } = require('../sync/steam-client');
const { getAccessToken } = require('../igdb/client');
const epicRun = require('../epic/run');
const epicClient = require('../epic/client');

const RESOLVE_VANITY_URL = 'https://api.steampowered.com/ISteamUser/ResolveVanityURL/v1/';
const OPENXBL_ACCOUNT_URL = 'https://xbl.io/api/v2/account';

const STEAM_ID_RE = /^\d{17}$/;

// Acepta un SteamID64 tal cual, una URL de perfil
// (https://steamcommunity.com/profiles/7656... o /id/nombre) o un nombre
// personalizado suelto. Devuelve { steamId } ya resuelto, o { error }.
async function resolveSteamId(input, { apiKey, fetchImpl = fetch } = {}) {
  const value = String(input || '').trim();
  if (!value) return { error: 'valor vacío' };

  if (STEAM_ID_RE.test(value)) return { steamId: value };

  const profilesMatch = value.match(/steamcommunity\.com\/profiles\/(\d{17})/);
  if (profilesMatch) return { steamId: profilesMatch[1] };

  const idMatch = value.match(/steamcommunity\.com\/id\/([^/?#]+)/);
  const vanity = idMatch ? decodeURIComponent(idMatch[1]) : value;

  if (!apiKey) {
    return { error: 'hace falta una STEAM_API_KEY válida para resolver un nombre a SteamID64' };
  }

  try {
    const url = new URL(RESOLVE_VANITY_URL);
    url.searchParams.set('key', apiKey);
    url.searchParams.set('vanityurl', vanity);
    const res = await fetchImpl(url);
    if (!res.ok) return { error: `Steam respondió ${res.status} al resolver "${vanity}"` };
    const body = await res.json();
    if (body?.response?.success === 1) return { steamId: body.response.steamid };
    return { error: body?.response?.message || `no se encontró ningún perfil "${vanity}"` };
  } catch (err) {
    return { error: err.message };
  }
}

// Comprueba clave + SteamID a la vez: GetOwnedGames necesita ambos y su
// respuesta dice cuántos juegos hay.
async function validateSteam({ apiKey, steamId, fetchImpl = fetch } = {}) {
  try {
    const data = await fetchOwnedGames({ apiKey, steamId, fetchImpl });
    const response = data?.response || {};
    if (response.game_count == null && !Array.isArray(response.games)) {
      return {
        ok: false,
        error: 'la API respondió vacío: revisa el SteamID, o pon tu perfil y "Detalles del juego" como públicos en Steam',
      };
    }
    const count = response.game_count ?? response.games.length;
    return { ok: true, detail: `${count} juegos en la biblioteca` };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// IGDB usa OAuth de client credentials contra Twitch: si Twitch devuelve un
// token, el Client ID + Secret de la app son correctos.
async function validateIgdb({ clientId, clientSecret, fetchImpl = fetch } = {}) {
  try {
    await getAccessToken({ clientId, clientSecret, fetchImpl });
    return { ok: true, detail: 'app de Twitch verificada' };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function validateOpenXbl({ apiKey, fetchImpl = fetch } = {}) {
  if (!apiKey) return { ok: false, error: 'OPENXBL_API_KEY no configurada' };
  try {
    const res = await fetchImpl(OPENXBL_ACCOUNT_URL, {
      headers: { 'X-Authorization': apiKey, Accept: 'application/json' },
    });
    if (!res.ok) return { ok: false, error: `OpenXBL respondió ${res.status}` };
    const body = await res.json();
    const settings = body?.profileUsers?.[0]?.settings || [];
    const gamertag = settings.find((s) => s.id === 'Gamertag')?.value;
    return { ok: true, detail: gamertag ? `cuenta ${gamertag}` : 'key válida' };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// Canjea el código de autorización de Epic por un refresh token y lo deja
// guardado en data/epic_auth.json (vía epic/run.js, misma ruta que usa el
// sync).
async function activateEpic(code, { authPath = epicRun.DEFAULT_AUTH_PATH, fetchImpl = fetch } = {}) {
  try {
    const accountId = await epicRun.loginWithCode(code, { authPath, fetchImpl });
    return { ok: true, detail: `sesión guardada (cuenta ${accountId})` };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// Refresca la sesión de Epic ya guardada y hace una consulta de humo. El
// refresh token de Epic rueda en cada uso, así que hay que volver a
// guardarlo o el siguiente sync real fallaría.
async function validateEpic({ authPath = epicRun.DEFAULT_AUTH_PATH, fetchImpl = fetch } = {}) {
  const stored = epicRun.loadAuth(authPath);
  if (!stored?.refreshToken) return { ok: false, error: 'sin sesión de Epic guardada' };
  try {
    const token = await epicClient.refreshAccessToken(stored.refreshToken, { fetchImpl });
    epicRun.saveAuth(authPath, {
      refreshToken: token.refreshToken,
      accountId: token.accountId || stored.accountId,
    });
    const rows = await epicClient.fetchPlaytime(
      token.accountId || stored.accountId,
      token.accessToken,
      { fetchImpl }
    );
    return { ok: true, detail: `${rows.length} juegos con horas registradas` };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

module.exports = {
  resolveSteamId,
  validateSteam,
  validateIgdb,
  validateOpenXbl,
  activateEpic,
  validateEpic,
  RESOLVE_VANITY_URL,
  OPENXBL_ACCOUNT_URL,
};
