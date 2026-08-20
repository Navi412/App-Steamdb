const test = require('node:test');
const assert = require('node:assert/strict');
const { validateManualGame, validateGameUpdate } = require('../core/game');

test('validateManualGame limpia espacios y acepta datos válidos', () => {
  const result = validateManualGame({ title: '  Celeste  ', platform: ' PC ' });
  assert.deepEqual(result, { title: 'Celeste', platform: 'PC' });
});

test('validateManualGame rechaza título vacío', () => {
  assert.throws(() => validateManualGame({ title: '   ', platform: 'PC' }));
});

test('validateManualGame rechaza platform vacío', () => {
  assert.throws(() => validateManualGame({ title: 'Celeste', platform: '' }));
});

test('validateGameUpdate solo devuelve los campos presentes', () => {
  assert.deepEqual(validateGameUpdate({ archived: true }), { archived: true });
  assert.deepEqual(validateGameUpdate({ title: ' Nuevo título ' }), { title: 'Nuevo título' });
});

test('validateGameUpdate rechaza title vacío si se manda', () => {
  assert.throws(() => validateGameUpdate({ title: '   ' }));
});
