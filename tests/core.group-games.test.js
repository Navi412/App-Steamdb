const test = require('node:test');
const assert = require('node:assert/strict');
const { groupGames, groupKey } = require('../core/group-games');

// Fila como la que devuelve db/games.rowToGame, con lo mínimo relevante.
function row(overrides = {}) {
  return {
    id: 1,
    source: 'steam',
    steamAppId: null,
    title: 'Celeste',
    platform: 'Steam',
    iconUrl: null,
    createdAt: '2024-01-01T00:00:00.000Z',
    missingSince: null,
    archived: false,
    totalMinutes: 0,
    achievementsTotal: 0,
    achievementsUnlocked: 0,
    igdbId: null,
    igdbMainMinutes: null,
    igdbCompletionistMinutes: null,
    igdbUpdatedAt: null,
    ...overrides,
  };
}

test('groupKey normaliza mayúsculas, ®/™, acentos y signos', () => {
  assert.equal(groupKey('Celeste'), groupKey('CELESTE'));
  assert.equal(groupKey('Call of Duty®'), 'call of duty');
  assert.equal(groupKey('Overcooked! 2'), 'overcooked 2');
  assert.equal(groupKey('Pokémon'), 'pokemon');
});

test('fusiona dos filas del mismo juego en distinta plataforma', () => {
  const games = groupGames([
    row({ id: 74, source: 'steam', platform: 'Steam', steamAppId: '504230', totalMinutes: 600 }),
    row({ id: 252, source: 'xbox', platform: 'Xbox', iconUrl: 'http://x/celeste.png', totalMinutes: 150 }),
  ]);

  assert.equal(games.length, 1);
  const celeste = games[0];
  assert.equal(celeste.totalMinutes, 750);
  assert.deepEqual(celeste.platforms, ['Steam', 'Xbox']);
  assert.deepEqual(celeste.platformIds, [74, 252]);
  assert.deepEqual(celeste.ids, [74, 252]);
  assert.equal(celeste.id, 74); // la más jugada es la principal
  assert.equal(celeste.steamAppId, '504230'); // carátula: gana la fila de Steam
});

test('la fila principal es la de más horas, con desempate por id menor', () => {
  const [g] = groupGames([
    row({ id: 9, platform: 'Xbox', source: 'xbox', totalMinutes: 100 }),
    row({ id: 3, platform: 'Steam', source: 'steam', totalMinutes: 100 }),
  ]);
  assert.equal(g.id, 3);
  assert.deepEqual(g.platforms, ['Steam', 'Xbox']);
});

test('un juego sin pareja pasa igual, con su id intacto', () => {
  const [g] = groupGames([row({ id: 5, title: 'Hollow Knight', platform: 'Switch', totalMinutes: 42 })]);
  assert.equal(g.id, 5);
  assert.equal(g.totalMinutes, 42);
  assert.deepEqual(g.platforms, ['Switch']);
  assert.deepEqual(g.platformIds, [5]);
});

test('archived solo si todas las filas del grupo lo están', () => {
  const [mixto] = groupGames([
    row({ id: 1, platform: 'Steam', archived: true }),
    row({ id: 2, platform: 'Xbox', archived: false }),
  ]);
  assert.equal(mixto.archived, false);

  const [todo] = groupGames([
    row({ id: 1, platform: 'Steam', archived: true }),
    row({ id: 2, platform: 'Xbox', archived: true }),
  ]);
  assert.equal(todo.archived, true);
});

test('logros y tiempos de IGDB se toman de la fila que los tiene', () => {
  const [g] = groupGames([
    row({ id: 1, platform: 'Steam', achievementsTotal: 30, achievementsUnlocked: 12 }),
    row({
      id: 2,
      platform: 'Xbox',
      igdbId: 77,
      igdbMainMinutes: 480,
      igdbCompletionistMinutes: 1200,
      totalMinutes: 999,
    }),
  ]);
  assert.equal(g.achievementsTotal, 30);
  assert.equal(g.achievementsUnlocked, 12);
  assert.equal(g.igdbId, 77);
  assert.equal(g.igdbMainMinutes, 480);
});

test('dos filas de la misma plataforma se dedupe en una sola etiqueta', () => {
  const [g] = groupGames([
    row({ id: 1, platform: 'Xbox', source: 'xbox', title: 'Death Stranding', totalMinutes: 10 }),
    row({ id: 2, platform: 'Xbox', source: 'xbox', title: 'DEATH STRANDING', totalMinutes: 20 }),
  ]);
  assert.deepEqual(g.platforms, ['Xbox']);
  assert.equal(g.totalMinutes, 30);
  assert.deepEqual(g.ids, [1, 2]);
});
