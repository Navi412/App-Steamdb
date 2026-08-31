const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeTitle, pickBestMatch } = require('../core/igdb');

test('normalizeTitle ignora mayúsculas, puntuación y acentos', () => {
  assert.equal(normalizeTitle('Hollow Knight: Silksong!'), 'hollow knight silksong');
  assert.equal(normalizeTitle('Pokémon Ámbar'), 'pokemon ambar');
});

test('pickBestMatch prioriza un match exacto de título aunque no sea el primer resultado', () => {
  const candidates = [
    { title: 'Hollow Knight: Silksong', igdbId: 10 },
    { title: 'Hollow Knight', igdbId: 20 },
  ];
  const match = pickBestMatch(candidates, 'Hollow Knight');
  assert.equal(match.igdbId, 20);
});

test('pickBestMatch cae al primer resultado si no hay match exacto', () => {
  const candidates = [
    { title: 'Hollow Knight: Silksong', igdbId: 10 },
    { title: 'Hollow Knight: Godmaster', igdbId: 30 },
  ];
  const match = pickBestMatch(candidates, 'Hollow Knight');
  assert.equal(match.igdbId, 10);
});

test('pickBestMatch da null con una lista vacía o ausente', () => {
  assert.equal(pickBestMatch([], 'X'), null);
  assert.equal(pickBestMatch(null, 'X'), null);
});
