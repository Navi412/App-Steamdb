const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeOwnedGames, normalizePlayerAchievements } = require('../sync/normalize');

test('normaliza una respuesta típica de GetOwnedGames', () => {
  const raw = {
    response: {
      game_count: 2,
      games: [
        { appid: 620, name: 'Portal 2', playtime_forever: 754, playtime_2weeks: 30, img_icon_url: 'abc123' },
        { appid: 400, name: 'Portal', playtime_forever: 0 },
      ],
    },
  };

  const result = normalizeOwnedGames(raw);

  assert.deepEqual(result[0], {
    externalId: '620',
    title: 'Portal 2',
    iconUrl: 'https://media.steampowered.com/steamcommunity/public/images/apps/620/abc123.jpg',
    playtimeForeverMinutes: 754,
    playtime2WeeksMinutes: 30,
  });

  assert.deepEqual(result[1], {
    externalId: '400',
    title: 'Portal',
    iconUrl: null,
    playtimeForeverMinutes: 0,
    playtime2WeeksMinutes: null,
  });
});

test('respuesta sin juegos (biblioteca vacía o perfil privado) da lista vacía', () => {
  assert.deepEqual(normalizeOwnedGames({ response: {} }), []);
  assert.deepEqual(normalizeOwnedGames({ response: { game_count: 0 } }), []);
});

test('normaliza logros de un juego con logros conseguidos y pendientes', () => {
  const raw = {
    playerstats: {
      success: true,
      achievements: [
        { apiname: 'ACH_WIN', achieved: 1, unlocktime: 1700000000, name: 'Ganador', description: 'Gana una partida' },
        { apiname: 'ACH_LOSE', achieved: 0, unlocktime: 0, name: 'Perdedor', description: 'Pierde una partida' },
      ],
    },
  };

  const result = normalizePlayerAchievements(raw);

  assert.equal(result.supported, true);
  assert.deepEqual(result.achievements[0], {
    apiName: 'ACH_WIN',
    achieved: true,
    unlockedAt: new Date(1700000000 * 1000).toISOString(),
    name: 'Ganador',
    description: 'Gana una partida',
  });
  assert.deepEqual(result.achievements[1], {
    apiName: 'ACH_LOSE',
    achieved: false,
    unlockedAt: null,
    name: 'Perdedor',
    description: 'Pierde una partida',
  });
});

test('un juego sin esquema de logros da supported=false, no un error', () => {
  const raw = { playerstats: { success: false, error: 'Requested app has no stats' } };
  assert.deepEqual(normalizePlayerAchievements(raw), { supported: false, achievements: [] });
  assert.deepEqual(normalizePlayerAchievements({}), { supported: false, achievements: [] });
});
