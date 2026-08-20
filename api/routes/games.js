const { validateManualGame, validateGameUpdate } = require('../../core/game');
const { buildManualSession } = require('../../core/session');
const gamesDb = require('../../db/games');
const sessionsDb = require('../../db/sessions');
const achievementsDb = require('../../db/achievements');
const { readJsonBody, sendJson } = require('../http-helpers');

function registerGameRoutes(router, db) {
  router.get('/api/games', (req, res) => {
    sendJson(res, 200, gamesDb.listGames(db));
  });

  router.post('/api/games', async (req, res) => {
    try {
      const body = await readJsonBody(req);
      const clean = validateManualGame(body);
      const game = gamesDb.insertManualGame(db, clean);
      sendJson(res, 201, game);
    } catch (err) {
      sendJson(res, 400, { error: err.message });
    }
  });

  router.get('/api/games/:id', (req, res, params) => {
    const game = gamesDb.getGameById(db, Number(params.id));
    if (!game) return sendJson(res, 404, { error: 'juego no encontrado' });
    sendJson(res, 200, game);
  });

  router.patch('/api/games/:id', async (req, res, params) => {
    try {
      const game = gamesDb.getGameById(db, Number(params.id));
      if (!game) return sendJson(res, 404, { error: 'juego no encontrado' });

      const body = await readJsonBody(req);
      const changes = validateGameUpdate(body);
      const updated = gamesDb.updateGame(db, Number(params.id), changes);
      sendJson(res, 200, updated);
    } catch (err) {
      sendJson(res, 400, { error: err.message });
    }
  });

  router.get('/api/games/:id/sessions', (req, res, params) => {
    sendJson(res, 200, sessionsDb.listSessionsForGame(db, Number(params.id)));
  });

  router.post('/api/games/:id/sessions', async (req, res, params) => {
    try {
      const game = gamesDb.getGameById(db, Number(params.id));
      if (!game) return sendJson(res, 404, { error: 'juego no encontrado' });

      const body = await readJsonBody(req);
      const draft = buildManualSession(body);
      const session = sessionsDb.insertSession(db, Number(params.id), draft);
      sendJson(res, 201, session);
    } catch (err) {
      sendJson(res, 400, { error: err.message });
    }
  });

  router.get('/api/games/:id/achievements', (req, res, params) => {
    sendJson(res, 200, achievementsDb.listAchievementsForGame(db, Number(params.id)));
  });
}

module.exports = { registerGameRoutes };
