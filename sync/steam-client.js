const OWNED_GAMES_URL = 'https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/';

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

module.exports = { fetchOwnedGames, OWNED_GAMES_URL };
