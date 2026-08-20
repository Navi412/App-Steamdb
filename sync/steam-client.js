const OWNED_GAMES_URL = 'https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/';
const PLAYER_ACHIEVEMENTS_URL = 'https://api.steampowered.com/ISteamUserStats/GetPlayerAchievements/v1/';

async function fetchOwnedGames({ apiKey, steamId, fetchImpl = fetch } = {}) {
  if (!apiKey) throw new Error('STEAM_API_KEY no configurada');
  if (!steamId) throw new Error('STEAM_ID no configurada');

  const url = new URL(OWNED_GAMES_URL);
  url.searchParams.set('key', apiKey);
  url.searchParams.set('steamid', steamId);
  url.searchParams.set('format', 'json');
  url.searchParams.set('include_appinfo', 'true');
  url.searchParams.set('include_played_free_games', 'true');

  const res = await fetchImpl(url);
  if (!res.ok) {
    throw new Error(`Steam API respondió ${res.status}`);
  }
  return res.json();
}

// Muchos juegos no tienen logros, y Steam lo señala con un HTTP de error
// (400/403) cuyo cuerpo trae playerstats.success=false, no con una lista
// vacía. Por eso aquí no se lanza en base al status HTTP: se devuelve el
// cuerpo tal cual y es normalizePlayerAchievements quien decide si el
// juego "no tiene logros" o si de verdad hay un problema.
async function fetchPlayerAchievements({ apiKey, steamId, appId, language = 'spanish', fetchImpl = fetch } = {}) {
  if (!apiKey) throw new Error('STEAM_API_KEY no configurada');
  if (!steamId) throw new Error('STEAM_ID no configurada');
  if (!appId) throw new Error('appId es obligatorio');

  const url = new URL(PLAYER_ACHIEVEMENTS_URL);
  url.searchParams.set('key', apiKey);
  url.searchParams.set('steamid', steamId);
  url.searchParams.set('appid', appId);
  url.searchParams.set('format', 'json');
  // Sin "l" Steam solo da apiname/achieved/unlocktime, sin nombre ni
  // descripción legibles.
  url.searchParams.set('l', language);

  const res = await fetchImpl(url);
  const body = await res.json().catch(() => null);
  if (!body || !body.playerstats) {
    throw new Error(`Steam API respondió ${res.status} sin cuerpo interpretable`);
  }
  return body;
}

module.exports = { fetchOwnedGames, fetchPlayerAchievements, OWNED_GAMES_URL, PLAYER_ACHIEVEMENTS_URL };
