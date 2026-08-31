const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openDatabase } = require('../db/connection');
const { migrate } = require('../db/migrate');
const gamesDb = require('../db/games');
const { upsertAchievement, listAchievementsForGame } = require('../db/achievements');

function tempDb() {
  const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'steamdb-achievements-test-')), 'test.sqlite');
  const db = openDatabase(dbPath);
  migrate(db);
  return db;
}

test('upsertAchievement inserta y luego actualiza el mismo logro', () => {
  const db = tempDb();
  const game = gamesDb.upsertExternalGame(db, { source: 'steam', externalId: '620', title: 'Portal 2', platform: 'Steam' });

  upsertAchievement(db, game.id, { apiName: 'ACH_WIN', name: 'Ganador', description: 'Gana', achieved: false, unlockedAt: null });
  let achievements = listAchievementsForGame(db, game.id);
  assert.equal(achievements.length, 1);
  assert.equal(achievements[0].achieved, false);

  upsertAchievement(db, game.id, {
    apiName: 'ACH_WIN',
    name: 'Ganador',
    description: 'Gana',
    achieved: true,
    unlockedAt: '2026-08-19T10:00:00.000Z',
  });
  achievements = listAchievementsForGame(db, game.id);
  assert.equal(achievements.length, 1);
  assert.equal(achievements[0].achieved, true);
  assert.equal(achievements[0].unlockedAt, '2026-08-19T10:00:00.000Z');
});

test('listGames refleja el conteo de logros de cada juego', () => {
  const db = tempDb();
  const game = gamesDb.upsertExternalGame(db, { source: 'steam', externalId: '620', title: 'Portal 2', platform: 'Steam' });

  upsertAchievement(db, game.id, { apiName: 'A', achieved: true, unlockedAt: '2026-08-19T10:00:00.000Z' });
  upsertAchievement(db, game.id, { apiName: 'B', achieved: false, unlockedAt: null });
  upsertAchievement(db, game.id, { apiName: 'C', achieved: false, unlockedAt: null });

  const listed = gamesDb.getGameById(db, game.id);
  assert.equal(listed.achievementsTotal, 3);
  assert.equal(listed.achievementsUnlocked, 1);
});
