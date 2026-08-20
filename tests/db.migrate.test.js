const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openDatabase } = require('../db/connection');
const { migrate } = require('../db/migrate');

function tempDbPath() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'steamdb-test-')), 'test.sqlite');
}

const EXPECTED_TABLES = [
  'games',
  'steam_snapshots',
  'play_sessions',
  'sync_anomalies',
  'sync_runs',
  'schema_migrations',
];

test('migrate crea todas las tablas esperadas', () => {
  const db = openDatabase(tempDbPath());
  migrate(db);

  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all()
    .map((row) => row.name);

  for (const table of EXPECTED_TABLES) {
    assert.ok(tables.includes(table), `falta la tabla ${table}`);
  }
});

test('migrate es idempotente: correr dos veces no falla ni duplica', () => {
  const db = openDatabase(tempDbPath());
  const firstRun = migrate(db);
  const secondRun = migrate(db);

  assert.ok(firstRun.length > 0);
  assert.deepEqual(secondRun, []);
});

test('games rechaza un juego steam sin steam_appid', () => {
  const db = openDatabase(tempDbPath());
  migrate(db);

  assert.throws(() => {
    db.prepare(
      `INSERT INTO games (source, title, platform, created_at) VALUES ('steam', 'Test', 'Steam', ?)`
    ).run(new Date().toISOString());
  });
});

test('games acepta un juego manual sin steam_appid', () => {
  const db = openDatabase(tempDbPath());
  migrate(db);

  db.prepare(
    `INSERT INTO games (source, title, platform, created_at) VALUES ('manual', 'Test', 'PS5', ?)`
  ).run(new Date().toISOString());

  const row = db.prepare('SELECT * FROM games').get();
  assert.equal(row.title, 'Test');
  assert.equal(row.steam_appid, null);
});
