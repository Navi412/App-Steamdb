const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createServer } = require('../api/server');

function tempDbPath() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'steamdb-static-test-')), 'test.sqlite');
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

test('sirve una página HTML aunque la URL traiga query string', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/game.html?id=31`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/html/);
  });
});

test('index.html se sirve en la raíz', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/`);
    assert.equal(res.status, 200);
  });
});

test('un intento de path traversal fuera de /ui se rechaza', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/../package.json`);
    assert.notEqual(res.status, 200);
  });
});
