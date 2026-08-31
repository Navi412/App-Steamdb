const fs = require('node:fs');
const path = require('node:path');
const { openDatabase } = require('../db/connection');
const { migrate } = require('../db/migrate');
const epicClient = require('./client');
const gamesDb = require('../db/games');
const snapshotsDb = require('../db/snapshots');
const sessionsDb = require('../db/sessions');
const anomaliesDb = require('../db/sync-anomalies');
const syncRunsDb = require('../db/sync-runs');
const { deriveSession } = require('../core/derive-session');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const DELAY_BETWEEN_ITEMS_MS = 150;

// El refresh token de Epic (dura ~23 días y rueda en cada uso) se guarda en
// un fichero aparte, no en .env: lo reescribe cada sync.
const DEFAULT_AUTH_PATH = process.env.EPIC_AUTH_PATH || path.join(__dirname, '..', 'data', 'epic_auth.json');

function loadAuth(authPath) {
  if (!fs.existsSync(authPath)) return null;
  return JSON.parse(fs.readFileSync(authPath, 'utf8'));
}

function saveAuth(authPath, { refreshToken, accountId }) {
  fs.mkdirSync(path.dirname(authPath), { recursive: true });
  fs.writeFileSync(authPath, JSON.stringify({ refreshToken, accountId }, null, 2));
}

// Paso único: canjea el código de autorización de la cuenta por un refresh
// token y lo deja guardado. A partir de aquí runEpicSync se apaña solo.
async function loginWithCode(code, { authPath = DEFAULT_AUTH_PATH, fetchImpl } = {}) {
  const token = await epicClient.exchangeAuthCode(code.trim(), { fetchImpl });
  saveAuth(authPath, token);
  return token.accountId;
}

// Mismo patrón que sync/run.js y xbox/run.js. Cruza el listado de horas
// jugadas con la biblioteca para resolver título e imagen de cada juego, y
// deriva sesiones del contador acumulado (segundos -> minutos).
async function runEpicSync({ db, authPath = DEFAULT_AUTH_PATH, fetchImpl, delayMs = DELAY_BETWEEN_ITEMS_MS } = {}) {
  const stored = loadAuth(authPath);
  if (!stored?.refreshToken) {
    throw new Error('no hay sesión de Epic: corre primero "npm run epic:login <código>"');
  }

  const runId = syncRunsDb.startRun(db);
  try {
    const token = await epicClient.refreshAccessToken(stored.refreshToken, { fetchImpl });
    saveAuth(authPath, token); // el refresh token nuevo reemplaza al viejo

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

if (require.main === module) {
  const [cmd, arg] = process.argv.slice(2);

  if (cmd === 'login') {
    if (!arg) {
      console.error('uso: npm run epic:login <código de autorización>');
      process.exit(1);
    }
    loginWithCode(arg)
      .then((accountId) => console.log(`Epic: sesión guardada (cuenta ${accountId}). Ya puedes correr "npm run sync:epic".`))
      .catch((err) => {
        console.error(`Epic login falló: ${err.message}`);
        process.exitCode = 1;
      });
  } else {
    const db = openDatabase();
    migrate(db);
    runEpicSync({ db })
      .then((r) => console.log(`Epic: ${r.added} nuevos, ${r.updated} con horas nuevas, ${r.skipped} descartados`))
      .catch((err) => {
        console.error(`falló la sincronización de Epic: ${err.message}`);
        process.exitCode = 1;
      });
  }
}

module.exports = { runEpicSync, loginWithCode };
