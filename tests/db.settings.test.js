const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openDatabase } = require('../db/connection');
const { migrate } = require('../db/migrate');
const { getSetting, setSetting } = require('../db/settings');

function tempDb() {
  const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'steamdb-settings-test-')), 'test.sqlite');
  const db = openDatabase(dbPath);
  migrate(db);
  return db;
}

test('getSetting devuelve null si la clave no existe', () => {
  const db = tempDb();
  assert.equal(getSetting(db, 'steamApiKey'), null);
});

test('setSetting guarda y getSetting lo recupera', () => {
  const db = tempDb();
  setSetting(db, 'steamApiKey', 'ABC123');
  assert.equal(getSetting(db, 'steamApiKey'), 'ABC123');
});

test('setSetting sobre una clave existente la actualiza en vez de duplicarla', () => {
  const db = tempDb();
  setSetting(db, 'steamId', '111');
  setSetting(db, 'steamId', '222');
  assert.equal(getSetting(db, 'steamId'), '222');
});
