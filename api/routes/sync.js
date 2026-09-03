const { runSync } = require('../../sync/run');
const { runXboxSync } = require('../../xbox/run');
const { runEpicSync } = require('../../epic/run');
const { sendJson } = require('../http-helpers');

// Un solo botón "Sincronizar" dispara todos los launchers en cadena. Cada
// uno es independiente: si Xbox no tiene API key o Epic no tiene sesión, se
// anota su error y se sigue con el resto. El endpoint solo devuelve 500 si
// ninguno pudo sincronizar.
function registerSyncRoutes(router, db, { fetchImpl, epicAuthPath } = {}) {
  let syncing = false;

  router.post('/api/sync', async (req, res) => {
    if (syncing) {
      sendJson(res, 409, { error: 'ya hay una sincronización en curso' });
      return;
    }

    const launchers = [
      ['steam', () => runSync({ db, apiKey: process.env.STEAM_API_KEY, steamId: process.env.STEAM_ID, fetchImpl })],
      ['xbox', () => runXboxSync({ db, apiKey: process.env.OPENXBL_API_KEY, fetchImpl })],
      ['epic', () => runEpicSync({ db, fetchImpl, authPath: epicAuthPath })],
    ];

    syncing = true;
    try {
      const results = {};
      for (const [name, run] of launchers) {
        try {
          results[name] = { ok: true, ...(await run()) };
        } catch (err) {
          results[name] = { ok: false, error: err.message };
        }
      }

      const values = Object.values(results);
      const gamesSynced = values.reduce((n, r) => n + (r.gamesSynced || 0), 0);

      if (values.some((r) => r.ok)) {
        sendJson(res, 200, { gamesSynced, launchers: results });
      } else {
        const detail = Object.entries(results)
          .map(([name, r]) => `${name}: ${r.error}`)
          .join(' | ');
        sendJson(res, 500, { error: detail, launchers: results });
      }
    } finally {
      syncing = false;
    }
  });
}

module.exports = { registerSyncRoutes };
