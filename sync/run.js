const { fetchOwnedGames, fetchPlayerAchievements } = require('./steam-client');
const { normalizeOwnedGames, normalizePlayerAchievements } = require('./normalize');
const gamesDb = require('../db/games');
const snapshotsDb = require('../db/snapshots');
const syncRunsDb = require('../db/sync-runs');
const sessionsDb = require('../db/sessions');
const anomaliesDb = require('../db/sync-anomalies');
const achievementsDb = require('../db/achievements');
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
      const game = gamesDb.upsertExternalGame(db, {
        source: 'steam',
        externalId: entry.externalId,
        title: entry.title,
        iconUrl: entry.iconUrl,
        platform: 'Steam',
      });

      const prevSnapshot = snapshotsDb.getLatestSnapshot(db, game.id);
      const newSnapshot = snapshotsDb.insertSnapshot(db, game.id, {
        source: 'steam',
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

      try {
        const rawAchievements = await fetchPlayerAchievements({
          apiKey,
          steamId,
          appId: entry.externalId,
          fetchImpl,
        });
        const { achievements } = normalizePlayerAchievements(rawAchievements);
        for (const achievement of achievements) {
          achievementsDb.upsertAchievement(db, game.id, achievement);
        }
      } catch (err) {
        // Un fallo al pedir logros de un juego concreto (rate limit, juego
        // sin estadísticas todavía, etc.) no debe abortar el resto de la
        // sincronización: las horas jugadas ya quedaron a salvo arriba.
        console.warn(`no se pudieron sincronizar logros de "${entry.title}": ${err.message}`);
      }
    }

    syncRunsDb.finishRun(db, runId, { gamesSynced: normalized.length });
    return { gamesSynced: normalized.length };
  } catch (err) {
    syncRunsDb.failRun(db, runId, err.message);
    throw err;
  }
}

module.exports = { runSync };
