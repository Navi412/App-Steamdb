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
  'game_external_ids',
  'game_covers',
  'playtime_snapshots',
  'play_sessions',
  'sync_anomalies',
  'sync_runs',
  'achievements',
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

test('games rechaza un source desconocido', () => {
  const db = openDatabase(tempDbPath());
  migrate(db);

  assert.throws(() => {
    db.prepare(
      `INSERT INTO games (source, title, platform, created_at) VALUES ('psn', 'Test', 'PS5', ?)`
    ).run(new Date().toISOString());
  });
});

test('games acepta las plataformas previstas y game_external_ids las liga a un id externo', () => {
  const db = openDatabase(tempDbPath());
  migrate(db);

  const now = new Date().toISOString();
  for (const source of ['steam', 'manual', 'epic', 'gog', 'xbox']) {
    db.prepare(
      `INSERT INTO games (source, title, platform, created_at) VALUES (?, ?, 'X', ?)`
    ).run(source, `Juego ${source}`, now);
  }

  const gameId = db.prepare("SELECT id FROM games WHERE source = 'xbox'").get().id;
  db.prepare(
    `INSERT INTO game_external_ids (game_id, source, external_id) VALUES (?, 'xbox', '9NBLGGH4R315')`
  ).run(gameId);

  const row = db
    .prepare('SELECT external_id FROM game_external_ids WHERE game_id = ? AND source = ?')
    .get(gameId, 'xbox');
  assert.equal(row.external_id, '9NBLGGH4R315');
});

test('game_external_ids no deja repetir el mismo id externo en una plataforma', () => {
  const db = openDatabase(tempDbPath());
  migrate(db);

  const now = new Date().toISOString();
  const a = db
    .prepare(`INSERT INTO games (source, title, platform, created_at) VALUES ('steam', 'A', 'Steam', ?)`)
    .run(now).lastInsertRowid;
  const b = db
    .prepare(`INSERT INTO games (source, title, platform, created_at) VALUES ('steam', 'B', 'Steam', ?)`)
    .run(now).lastInsertRowid;

  db.prepare(`INSERT INTO game_external_ids (game_id, source, external_id) VALUES (?, 'steam', '620')`).run(a);
  assert.throws(() => {
    db.prepare(`INSERT INTO game_external_ids (game_id, source, external_id) VALUES (?, 'steam', '620')`).run(b);
  });
});
