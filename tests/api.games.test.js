const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createServer } = require('../api/server');

function tempDbPath() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'steamdb-api-test-')), 'test.sqlite');
}

async function withServer(fn) {
  process.env.DB_PATH = tempDbPath();
  const server = createServer();
  await new Promise((resolve) => server.listen(0, resolve));
  const base = `http://localhost:${server.address().port}`;
  try {
    await fn(base);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function postJson(base, url, body) {
  return fetch(`${base}${url}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

test('POST /api/games crea un juego manual y aparece en GET /api/games', async () => {
  await withServer(async (base) => {
    const createRes = await postJson(base, '/api/games', { title: 'Hollow Knight', platform: 'Switch' });
    assert.equal(createRes.status, 201);
    const created = await createRes.json();
    assert.equal(created.title, 'Hollow Knight');
    assert.equal(created.source, 'manual');
    assert.equal(created.totalMinutes, 0);

    const games = await (await fetch(`${base}/api/games`)).json();
    assert.equal(games.length, 1);
    assert.equal(games[0].id, created.id);
  });
});

test('POST /api/games rechaza título vacío', async () => {
  await withServer(async (base) => {
    const res = await postJson(base, '/api/games', { title: '', platform: 'PC' });
    assert.equal(res.status, 400);
  });
});

test('registrar sesiones manuales suma minutos al total del juego', async () => {
  await withServer(async (base) => {
    const game = await (await postJson(base, '/api/games', { title: 'Celeste', platform: 'PC' })).json();

    await postJson(base, `/api/games/${game.id}/sessions`, { minutes: 90 });
    await postJson(base, `/api/games/${game.id}/sessions`, { minutes: 30, note: 'capítulo 3' });

    const games = await (await fetch(`${base}/api/games`)).json();
    assert.equal(games[0].totalMinutes, 120);

    const sessions = await (await fetch(`${base}/api/games/${game.id}/sessions`)).json();
    assert.equal(sessions.length, 2);
  });
});

test('POST de sesión en juego inexistente da 404', async () => {
  await withServer(async (base) => {
    const res = await postJson(base, '/api/games/999/sessions', { minutes: 10 });
    assert.equal(res.status, 404);
  });
});

test('PATCH /api/games/:id archiva un juego', async () => {
  await withServer(async (base) => {
    const game = await (await postJson(base, '/api/games', { title: 'Outer Wilds', platform: 'PC' })).json();

    const patchRes = await fetch(`${base}/api/games/${game.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ archived: true }),
    });
    assert.equal(patchRes.status, 200);
    const updated = await patchRes.json();
    assert.equal(updated.archived, true);
  });
});
