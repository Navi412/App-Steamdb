const { openDatabase } = require('../db/connection');
const { migrate } = require('../db/migrate');
const { fetchOwnedGames } = require('./steam-client');
const { normalizeOwnedGames } = require('./normalize');
const gamesDb = require('../db/games');
const snapshotsDb = require('../db/snapshots');
const syncRunsDb = require('../db/sync-runs');
const sessionsDb = require('../db/sessions');
const anomaliesDb = require('../db/sync-anomalies');
const { deriveSession } = require('../core/derive-session');

// Da de alta juegos nuevos, guarda una instantánea por juego, y deriva
// (core/derive-session) la sesión y/o anomalía correspondiente comparando
// contra la instantánea anterior de ese mismo juego.
async function runSync({ db, apiKey, steamId, fetchImpl } = {}) {
  const runId = syncRunsDb.startRun(db);

  try {
    const raw = await fetchOwnedGames({ apiKey, steamId, fetchImpl });
    const normalized = normalizeOwnedGames(raw);
    const capturedAt = new Date().toISOString();

    for (const entry of normalized) {
      const game = gamesDb.upsertSteamGame(db, {
        steamAppId: entry.steamAppId,
        title: entry.title,
        iconUrl: entry.iconUrl,
      });

      const prevSnapshot = snapshotsDb.getLatestSnapshot(db, game.id);
      const newSnapshot = snapshotsDb.insertSnapshot(db, game.id, {
        capturedAt,
        playtimeForeverMinutes: entry.playtimeForeverMinutes,
        playtime2WeeksMinutes: entry.playtime2WeeksMinutes,
      });

      const { session, anomaly } = deriveSession(prevSnapshot, newSnapshot);

      if (session) {
        sessionsDb.insertSession(db, game.id, { ...session, sourceSnapshotId: newSnapshot.id });
      }
      if (anomaly) {
        anomaliesDb.insertAnomaly(db, game.id, anomaly);
      }
    }

    syncRunsDb.finishRun(db, runId, { gamesSynced: normalized.length });
    return { gamesSynced: normalized.length };
  } catch (err) {
    syncRunsDb.failRun(db, runId, err.message);
    throw err;
  }
}

if (require.main === module) {
  const db = openDatabase();
  migrate(db);
  runSync({ db, apiKey: process.env.STEAM_API_KEY, steamId: process.env.STEAM_ID })
    .then(({ gamesSynced }) => {
      console.log(`sincronizados ${gamesSynced} juegos`);
    })
    .catch((err) => {
      console.error(`fallo la sincronización: ${err.message}`);
      process.exitCode = 1;
    });
}

module.exports = { runSync };
