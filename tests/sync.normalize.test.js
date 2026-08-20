const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeOwnedGames } = require('../sync/normalize');

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
    steamAppId: 620,
    title: 'Portal 2',
    iconUrl: 'https://media.steampowered.com/steamcommunity/public/images/apps/620/abc123.jpg',
    playtimeForeverMinutes: 754,
    playtime2WeeksMinutes: 30,
  });

  assert.deepEqual(result[1], {
    steamAppId: 400,
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
