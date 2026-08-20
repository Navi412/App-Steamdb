const { runSync } = require('../../sync/run');
const { sendJson } = require('../http-helpers');

function registerSyncRoutes(router, db, { fetchImpl } = {}) {
  let syncing = false;

  router.post('/api/sync', async (req, res) => {
    if (syncing) {
      sendJson(res, 409, { error: 'ya hay una sincronización en curso' });
      return;
    }

    syncing = true;
    try {
      const result = await runSync({
        db,
        apiKey: process.env.STEAM_API_KEY,
        steamId: process.env.STEAM_ID,
        fetchImpl,
      });
      sendJson(res, 200, result);
    } catch (err) {
      sendJson(res, 500, { error: err.message });
    } finally {
      syncing = false;
    }
  });
}

module.exports = { registerSyncRoutes };
