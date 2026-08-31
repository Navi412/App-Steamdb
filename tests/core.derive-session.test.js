const test = require('node:test');
const assert = require('node:assert/strict');
const { deriveSession } = require('../core/derive-session');

test('primera instantánea con backlog crea una sesión sin fecha de inicio', () => {
  const { session, anomaly } = deriveSession(null, {
    capturedAt: '2026-08-20T10:00:00.000Z',
    playtimeForeverMinutes: 500,
  });

  assert.equal(anomaly, null);
  assert.deepEqual(session, {
    minutes: 500,
    startedAt: null,
    endedAt: '2026-08-20T10:00:00.000Z',
    precision: 'derived',
    origin: 'steam_sync',
    note: null,
  });
});

test('el origin es configurable (xbox_sync) y por defecto es steam_sync', () => {
  const curr = { capturedAt: '2026-08-20T10:00:00.000Z', playtimeForeverMinutes: 500 };
  assert.equal(deriveSession(null, curr).session.origin, 'steam_sync');
  assert.equal(deriveSession(null, curr, 'xbox_sync').session.origin, 'xbox_sync');

  const prev = { capturedAt: '2026-08-20T10:00:00.000Z', playtimeForeverMinutes: 500 };
  const next = { capturedAt: '2026-08-20T12:00:00.000Z', playtimeForeverMinutes: 560 };
  assert.equal(deriveSession(prev, next, 'xbox_sync').session.origin, 'xbox_sync');
});

test('primera instantánea con 0 minutos no crea nada', () => {
  const result = deriveSession(null, { capturedAt: '2026-08-20T10:00:00.000Z', playtimeForeverMinutes: 0 });
  assert.deepEqual(result, { session: null, anomaly: null });
});

test('el contador sube: sesión normal acotada por las dos instantáneas', () => {
  const prev = { capturedAt: '2026-08-20T10:00:00.000Z', playtimeForeverMinutes: 500 };
  const curr = { capturedAt: '2026-08-20T12:00:00.000Z', playtimeForeverMinutes: 560 };

  const { session, anomaly } = deriveSession(prev, curr);

  assert.equal(anomaly, null);
  assert.deepEqual(session, {
    minutes: 60,
    startedAt: '2026-08-20T10:00:00.000Z',
    endedAt: '2026-08-20T12:00:00.000Z',
    precision: 'derived',
    origin: 'steam_sync',
    note: null,
  });
});

test('el contador se mantiene igual: no hay nada que registrar', () => {
  const snapshot = { capturedAt: '2026-08-20T10:00:00.000Z', playtimeForeverMinutes: 500 };
  const result = deriveSession(snapshot, { ...snapshot, capturedAt: '2026-08-20T12:00:00.000Z' });
  assert.deepEqual(result, { session: null, anomaly: null });
});

test('el contador baja: anomalía, ninguna sesión negativa', () => {
  const prev = { capturedAt: '2026-08-20T10:00:00.000Z', playtimeForeverMinutes: 500 };
  const curr = { capturedAt: '2026-08-20T12:00:00.000Z', playtimeForeverMinutes: 100 };

  const { session, anomaly } = deriveSession(prev, curr);

  assert.equal(session, null);
  assert.equal(anomaly.kind, 'playtime_decreased');
  assert.deepEqual(JSON.parse(anomaly.detail), {
    previousMinutes: 500,
    currentMinutes: 100,
    previousCapturedAt: '2026-08-20T10:00:00.000Z',
    currentCapturedAt: '2026-08-20T12:00:00.000Z',
  });
});
