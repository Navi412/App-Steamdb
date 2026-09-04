const test = require('node:test');
const assert = require('node:assert/strict');
const { validateManualGame, validateGameUpdate, validateCoverInput } = require('../core/game');

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

test('validateCoverInput acepta un data URI de imagen', () => {
  const r = validateCoverInput({ dataUrl: 'data:image/png;base64,iVBORw0KGgo=' });
  assert.deepEqual(r, { kind: 'blob', mime: 'image/png', base64: 'iVBORw0KGgo=' });
});

test('validateCoverInput rechaza un mime que no es imagen admitida', () => {
  assert.throws(() => validateCoverInput({ dataUrl: 'data:text/plain;base64,aGk=' }));
});

test('validateCoverInput rechaza un base64 con basura', () => {
  assert.throws(() => validateCoverInput({ dataUrl: 'data:image/png;base64,no válido!!' }));
});

test('validateCoverInput rechaza una imagen que supera el máximo', () => {
  const huge = 'data:image/png;base64,' + 'A'.repeat(8 * 1024 * 1024);
  assert.throws(() => validateCoverInput({ dataUrl: huge }), /máximo/);
});

test('validateCoverInput acepta una url http(s) y limpia espacios', () => {
  assert.deepEqual(validateCoverInput({ url: '  https://ejemplo/x.png  ' }), {
    kind: 'url',
    url: 'https://ejemplo/x.png',
  });
});

test('validateCoverInput rechaza urls que no son http(s)', () => {
  assert.throws(() => validateCoverInput({ url: 'ftp://ejemplo/x.png' }));
});

test('validateCoverInput exige alguna imagen y no las dos formas a la vez', () => {
  assert.throws(() => validateCoverInput({}));
  assert.throws(() => validateCoverInput({ dataUrl: 'data:image/png;base64,aGk=', url: 'https://x/y' }));
});
