const test = require('node:test');
const assert = require('node:assert/strict');
const { buildManualSession } = require('../core/session');

test('sesión manual solo con minutos queda como approximate', () => {
  const session = buildManualSession({ minutes: 45 });
  assert.equal(session.precision, 'approximate');
  assert.equal(session.startedAt, null);
  assert.equal(session.endedAt, null);
  assert.equal(session.origin, 'manual');
});

test('sesión manual con inicio y fin queda como exact', () => {
  const session = buildManualSession({
    minutes: 60,
    startedAt: '2026-08-19T20:00:00.000Z',
    endedAt: '2026-08-19T21:00:00.000Z',
  });
  assert.equal(session.precision, 'exact');
});

test('rechaza minutos no positivos', () => {
  assert.throws(() => buildManualSession({ minutes: 0 }));
  assert.throws(() => buildManualSession({ minutes: -5 }));
  assert.throws(() => buildManualSession({ minutes: 1.5 }));
});

test('rechaza startedAt sin endedAt', () => {
  assert.throws(() => buildManualSession({ minutes: 30, startedAt: '2026-08-19T20:00:00.000Z' }));
});
