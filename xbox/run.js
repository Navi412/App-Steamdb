const { openDatabase } = require('../db/connection');
const { migrate } = require('../db/migrate');
const xboxClient = require('./client');
const gamesDb = require('../db/games');
const snapshotsDb = require('../db/snapshots');
const sessionsDb = require('../db/sessions');
const anomaliesDb = require('../db/sync-anomalies');
const syncRunsDb = require('../db/sync-runs');
const { deriveSession } = require('../core/derive-session');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const DELAY_BETWEEN_TITLES_MS = 250;

// OpenXBL gratis permite ~150 peticiones/hora. Cada juego con novedades
// gasta una (buscar su "MinutesPlayed"), más una del historial. Con más
// juegos que eso en la primera pasada, se para en seco y se retoma en la
// siguiente: los juegos que quedaron sin instantánea se procesan entonces.
const DEFAULT_REQUEST_BUDGET = 140;

function looksLikeRateLimit(err) {
  return /\b429\b/.test(err.message);
}

// Mismo patrón que sync/run.js pero contra Xbox. Da de alta los juegos del
// historial y, para los que tienen novedades (sin instantánea previa o
// jugados desde la última), guarda una instantánea del contador
// "MinutesPlayed" y deriva la sesión/anomalía. Un juego sin dato de minutos
// se da de alta igual (para que salga en la lista) pero sin instantánea.
async function runXboxSync({
  db,
  apiKey,
  fetchImpl,
  delayMs = DELAY_BETWEEN_TITLES_MS,
  requestBudget = DEFAULT_REQUEST_BUDGET,
} = {}) {
  const runId = syncRunsDb.startRun(db);

  try {
    const titles = await xboxClient.fetchPlayedTitles({ apiKey, fetchImpl });
    const capturedAt = new Date().toISOString();

    const stats = { added: 0, updated: 0, skipped: 0, pending: 0 };
    let requests = 0;
    let budgetExhausted = false;

    for (const entry of titles) {
      const game = gamesDb.upsertExternalGame(db, {
        source: 'xbox',
        externalId: entry.titleId,
        title: entry.title,
        iconUrl: entry.iconUrl,
        platform: 'Xbox',
      });

      const prevSnapshot = snapshotsDb.getLatestSnapshot(db, game.id);

      // Sin novedades desde la última instantánea: no gastar petición.
      if (prevSnapshot && entry.lastPlayed && entry.lastPlayed <= prevSnapshot.capturedAt) {
        stats.skipped += 1;
        continue;
      }

      // Fin del presupuesto (o límite real de OpenXBL): se sigue el bucle
      // solo para dar de alta los juegos que falten y contarlos.
      if (budgetExhausted || requests >= requestBudget) {
        stats.pending += 1;
        continue;
      }

      let minutes;
      try {
        requests += 1;
        minutes = await xboxClient.fetchMinutesPlayed(entry.titleId, { apiKey, fetchImpl });
      } catch (err) {
        if (looksLikeRateLimit(err)) {
          budgetExhausted = true;
          stats.pending += 1;
          continue;
        }
        throw err;
      }

      // Xbox sin dato de minutos para este juego: se guarda una instantánea
      // a 0 igualmente. Así queda constancia de que ya se consultó y no se
      // vuelve a gastar una petición en él en cada sync; si más adelante
      // Xbox empieza a contar horas, la resta lo recoge.
      const noData = minutes === null;
      const newSnapshot = snapshotsDb.insertSnapshot(db, game.id, {
        source: 'xbox',
        capturedAt,
        playtimeForeverMinutes: noData ? 0 : minutes,
        playtime2WeeksMinutes: null,
      });

      const { session, anomaly } = deriveSession(prevSnapshot, newSnapshot, 'xbox_sync');
      if (session) {
        sessionsDb.insertSession(db, game.id, { ...session, sourceSnapshotId: newSnapshot.id });
      }
      if (anomaly) {
        anomaliesDb.insertAnomaly(db, game.id, anomaly);
      }

      if (noData) stats.skipped += 1;
      else stats[prevSnapshot ? 'updated' : 'added'] += 1;

      if (delayMs > 0) await sleep(delayMs);
    }

    syncRunsDb.finishRun(db, runId, { gamesSynced: titles.length });
    return { gamesSynced: titles.length, stoppedEarly: stats.pending > 0, ...stats };
  } catch (err) {
    syncRunsDb.failRun(db, runId, err.message);
    throw err;
  }
}

if (require.main === module) {
  const db = openDatabase();
  migrate(db);
  runXboxSync({ db, apiKey: process.env.OPENXBL_API_KEY })
    .then((r) => {
      console.log(
        `Xbox: ${r.gamesSynced} en el historial | ${r.added} nuevos, ${r.updated} con horas nuevas, ` +
          `${r.skipped} sin cambios/sin dato`
      );
      if (r.stoppedEarly) {
        console.log(
          `\nSe alcanzó el límite de OpenXBL con ${r.pending} juegos aún por procesar. ` +
            `Vuelve a correr "npm run sync:xbox" dentro de una hora para terminar.`
        );
      }
    })
    .catch((err) => {
      console.error(`falló la sincronización de Xbox: ${err.message}`);
      process.exitCode = 1;
    });
}

module.exports = { runXboxSync };
