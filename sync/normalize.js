function normalizeOwnedGames(rawResponse) {
  const games = rawResponse?.response?.games || [];

  return games.map((game) => ({
    externalId: String(game.appid),
    title: game.name,
    iconUrl: game.img_icon_url
      ? `https://media.steampowered.com/steamcommunity/public/images/apps/${game.appid}/${game.img_icon_url}.jpg`
      : null,
    playtimeForeverMinutes: game.playtime_forever,
    playtime2WeeksMinutes: game.playtime_2weeks ?? null,
  }));
}

function normalizePlayerAchievements(rawResponse) {
  const stats = rawResponse?.playerstats;

  if (!stats || stats.success === false || !Array.isArray(stats.achievements)) {
    // Juego sin esquema de logros, perfil inaccesible, etc. No es un
    // error: simplemente no hay nada que sincronizar para este juego.
    return { supported: false, achievements: [] };
  }

  return {
    supported: true,
    achievements: stats.achievements.map((achievement) => ({
      apiName: achievement.apiname,
      achieved: Boolean(achievement.achieved),
      unlockedAt:
        achievement.achieved && achievement.unlocktime
          ? new Date(achievement.unlocktime * 1000).toISOString()
          : null,
      name: achievement.name ?? null,
      description: achievement.description ?? null,
    })),
  };
}

module.exports = { normalizeOwnedGames, normalizePlayerAchievements };
