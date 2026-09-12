const { openDatabase } = require('../db/connection');
const { migrate } = require('../db/migrate');
const edenClient = require('./client');
const gamesDb = require('../db/games');
const snapshotsDb = require('../db/snapshots');
const sessionsDb = require('../db/sessions');
const anomaliesDb = require('../db/sync-anomalies');
const syncRunsDb = require('../db/sync-runs');
const { deriveSession } = require('../core/derive-session');

// Mismo patrón que gog/run.js: la fuente es la carpeta de datos local de
// Eden en vez de una API. Da de alta los juegos de Switch detectados,
// guarda una instantánea del contador acumulado de minutos y deriva la
// sesión/anomalía del intervalo. Eden no tiene logros, así que a
// diferencia de GOG aquí no hay nada que volcar en /db/achievements.
function runEdenSync({ db, dataDir, now = () => new Date().toISOString() } = {}) {
  const runId = syncRunsDb.startRun(db);

  try {
    const { games, skipped } = edenClient.readEdenLibrary({ dataDir });
    const capturedAt = now();
    const stats = { added: 0, updated: 0, unchanged: 0 };

    for (const entry of games) {
      const game = gamesDb.upsertExternalGame(db, {
        source: 'eden',
        externalId: entry.edenId,
        title: entry.title,
        iconUrl: null,
        platform: 'Switch',
      });

      const prevSnapshot = snapshotsDb.getLatestSnapshot(db, game.id);

      // Sin cambios en el contador desde la última instantánea: no se
      // apila una nueva.
      if (prevSnapshot && prevSnapshot.playtimeForeverMinutes === entry.minutes) {
        stats.unchanged += 1;
      } else {
        const newSnapshot = snapshotsDb.insertSnapshot(db, game.id, {
          source: 'eden',
          capturedAt,
          playtimeForeverMinutes: entry.minutes,
          playtime2WeeksMinutes: null,
        });

        const { session, anomaly } = deriveSession(prevSnapshot, newSnapshot, 'eden_sync');
        if (session) {
          sessionsDb.insertSession(db, game.id, { ...session, sourceSnapshotId: newSnapshot.id });
        }
        if (anomaly) {
          anomaliesDb.insertAnomaly(db, game.id, anomaly);
        }

        stats[prevSnapshot ? 'updated' : 'added'] += 1;
      }
    }

    syncRunsDb.finishRun(db, runId, { gamesSynced: games.length });
    return { gamesSynced: games.length, skippedFiles: skipped.map((s) => s.file), ...stats };
  } catch (err) {
    syncRunsDb.failRun(db, runId, err.message);
    throw err;
  }
}

if (require.main === module) {
  const db = openDatabase();
  migrate(db);
  try {
    const r = runEdenSync({ db });
    console.log(
      `Eden: ${r.gamesSynced} juegos | ${r.added} nuevos, ${r.updated} con horas nuevas, ` +
        `${r.unchanged} sin cambios${r.skippedFiles.length ? `, ${r.skippedFiles.length} archivos sin id de título reconocible` : ''}`
    );
  } catch (err) {
    console.error(`falló la sincronización de Eden: ${err.message}`);
    process.exitCode = 1;
  }
}

module.exports = { runEdenSync };
