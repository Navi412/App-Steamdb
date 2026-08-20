function normalizeOwnedGames(rawResponse) {
  const games = rawResponse?.response?.games || [];

  return games.map((game) => ({
    steamAppId: game.appid,
    title: game.name,
    iconUrl: game.img_icon_url
      ? `https://media.steampowered.com/steamcommunity/public/images/apps/${game.appid}/${game.img_icon_url}.jpg`
      : null,
    playtimeForeverMinutes: game.playtime_forever,
    playtime2WeeksMinutes: game.playtime_2weeks ?? null,
  }));
}

module.exports = { normalizeOwnedGames };
