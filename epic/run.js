const epicClient = require('./client');
const gamesDb = require('../db/games');
const snapshotsDb = require('../db/snapshots');
const sessionsDb = require('../db/sessions');
const anomaliesDb = require('../db/sync-anomalies');
const syncRunsDb = require('../db/sync-runs');
const { deriveSession } = require('../core/derive-session');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const DELAY_BETWEEN_ITEMS_MS = 150;

// Dónde guardar el refresh token es intercambiable (mismo patrón que
// `fetchImpl` y `sqliteImpl` en el resto del proyecto): `authStore` es
// cualquier objeto con load()/save(). El escritorio usa un fichero
// (epic/file-auth-store.js); el móvil, que no tiene `node:fs`, guarda los
// mismos campos como fila de /db/settings.js. Este módulo no importa nada
// de `node:fs` a propósito — lo requiere directamente el móvil, y Metro
// empaqueta cualquier require() que aparezca en el fichero aunque esté en
// una rama que nunca se ejecute ahí.

// Paso único: canjea el código de autorización de la cuenta por un refresh
// token y lo deja guardado en `authStore`. A partir de aquí runEpicSync se
// apaña solo.
async function loginWithCode(code, { authStore, fetchImpl } = {}) {
  const token = await epicClient.exchangeAuthCode(code.trim(), { fetchImpl });
  authStore.save(token);
  return token.accountId;
}

// Mismo patrón que sync/run.js y xbox/run.js. Cruza el listado de horas
// jugadas con la biblioteca para resolver título e imagen de cada juego, y
// deriva sesiones del contador acumulado (segundos -> minutos).
async function runEpicSync({ db, authStore, fetchImpl, delayMs = DELAY_BETWEEN_ITEMS_MS } = {}) {
  const stored = authStore.load();
  if (!stored?.refreshToken) {
    throw new Error('no hay sesión de Epic: corre primero "npm run epic:login <código>"');
  }

  const runId = syncRunsDb.startRun(db);
  try {
    const token = await epicClient.refreshAccessToken(stored.refreshToken, { fetchImpl });
    authStore.save(token); // el refresh token nuevo reemplaza al viejo

    const accountId = token.accountId || stored.accountId;
    const [playtime, assets] = await Promise.all([
      epicClient.fetchPlaytime(accountId, token.accessToken, { fetchImpl }),
      epicClient.fetchOwnedAssets(token.accessToken, { fetchImpl }),
    ]);

    const capturedAt = new Date().toISOString();
    const stats = { added: 0, updated: 0, skipped: 0 };

    for (const entry of playtime) {
      const asset = assets[entry.artifactId];
      if (!asset) {
        stats.skipped += 1; // sin entrada en la biblioteca no se puede resolver
        continue;
      }

      const meta = await epicClient.fetchCatalogItem(
        asset.namespace,
        asset.catalogItemId,
        token.accessToken,
        { fetchImpl }
      );
      if (delayMs > 0) await sleep(delayMs);

      if (!meta || !meta.isGame) {
        stats.skipped += 1;
        continue;
      }

      const game = gamesDb.upsertExternalGame(db, {
        source: 'epic',
        externalId: entry.artifactId,
        title: meta.title,
        iconUrl: meta.iconUrl,
        platform: 'Epic',
      });

      const prevSnapshot = snapshotsDb.getLatestSnapshot(db, game.id);
      const newSnapshot = snapshotsDb.insertSnapshot(db, game.id, {
        source: 'epic',
        capturedAt,
        playtimeForeverMinutes: entry.minutes,
        playtime2WeeksMinutes: null,
      });

      const { session, anomaly } = deriveSession(prevSnapshot, newSnapshot, 'epic_sync');
      if (session) sessionsDb.insertSession(db, game.id, { ...session, sourceSnapshotId: newSnapshot.id });
      if (anomaly) anomaliesDb.insertAnomaly(db, game.id, anomaly);

      stats[prevSnapshot ? 'updated' : 'added'] += 1;
    }

    syncRunsDb.finishRun(db, runId, { gamesSynced: stats.added + stats.updated });
    return { gamesSynced: stats.added + stats.updated, ...stats };
  } catch (err) {
    syncRunsDb.failRun(db, runId, err.message);
    throw err;
  }
}

module.exports = { runEpicSync, loginWithCode };
