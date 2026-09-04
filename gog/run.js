const { openDatabase } = require('../db/connection');
const { migrate } = require('../db/migrate');
const gogClient = require('./client');
const gamesDb = require('../db/games');
const snapshotsDb = require('../db/snapshots');
const sessionsDb = require('../db/sessions');
const achievementsDb = require('../db/achievements');
const anomaliesDb = require('../db/sync-anomalies');
const syncRunsDb = require('../db/sync-runs');
const { deriveSession } = require('../core/derive-session');

// Mismo patrón que sync/run.js, xbox/run.js y epic/run.js, pero la fuente
// es la base local de GOG Galaxy en vez de una API. Da de alta los juegos
// de la biblioteca de GOG, guarda una instantánea del contador acumulado
// de minutos y deriva la sesión/anomalía; además vuelca los logros que
// Galaxy tenga sincronizados.
function runGogSync({ db, dbPath, now = () => new Date().toISOString() } = {}) {
  const runId = syncRunsDb.startRun(db);

  try {
    const { games, skipped } = gogClient.readGogLibrary({ dbPath });
    const capturedAt = now();
    const stats = { added: 0, updated: 0, unchanged: 0, skippedNonGames: skipped.length };

    for (const entry of games) {
      const game = gamesDb.upsertExternalGame(db, {
        source: 'gog',
        externalId: entry.gogId,
        title: entry.title,
        iconUrl: entry.coverUrl,
        platform: 'GOG',
      });

      const prevSnapshot = snapshotsDb.getLatestSnapshot(db, game.id);

      // Sin cambios en el contador desde la última instantánea: no se
      // apila una nueva (la biblioteca de GOG cambia poco y la resta
      // daría 0 igualmente).
      if (prevSnapshot && prevSnapshot.playtimeForeverMinutes === entry.minutes) {
        stats.unchanged += 1;
      } else {
        const newSnapshot = snapshotsDb.insertSnapshot(db, game.id, {
          source: 'gog',
          capturedAt,
          playtimeForeverMinutes: entry.minutes,
          playtime2WeeksMinutes: null,
        });

        const { session, anomaly } = deriveSession(prevSnapshot, newSnapshot, 'gog_sync');
        if (session) {
          sessionsDb.insertSession(db, game.id, { ...session, sourceSnapshotId: newSnapshot.id });
        }
        if (anomaly) {
          anomaliesDb.insertAnomaly(db, game.id, anomaly);
        }

        stats[prevSnapshot ? 'updated' : 'added'] += 1;
      }

      for (const ach of entry.achievements) {
        achievementsDb.upsertAchievement(db, game.id, ach);
      }
    }

    syncRunsDb.finishRun(db, runId, { gamesSynced: games.length });
    return { gamesSynced: games.length, skippedTitles: skipped.map((s) => s.title).filter(Boolean), ...stats };
  } catch (err) {
    syncRunsDb.failRun(db, runId, err.message);
    throw err;
  }
}

if (require.main === module) {
  const db = openDatabase();
  migrate(db);
  try {
    const r = runGogSync({ db });
    console.log(
      `GOG: ${r.gamesSynced} juegos | ${r.added} nuevos, ${r.updated} con horas nuevas, ` +
        `${r.unchanged} sin cambios${r.skippedNonGames ? `, ${r.skippedNonGames} descartados (no son juegos)` : ''}`
    );
  } catch (err) {
    console.error(`falló la sincronización de GOG: ${err.message}`);
    process.exitCode = 1;
  }
}

module.exports = { runGogSync };
