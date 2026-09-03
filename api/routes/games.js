const { validateManualGame, validateGameUpdate, validateIgdbUpdate } = require('../../core/game');
const { buildManualSession } = require('../../core/session');
const { pickBestMatch } = require('../../core/igdb');
const { groupGames } = require('../../core/group-games');
const gamesDb = require('../../db/games');
const sessionsDb = require('../../db/sessions');
const achievementsDb = require('../../db/achievements');
const igdbClient = require('../../igdb/client');
const { readJsonBody, sendJson } = require('../http-helpers');

function registerGameRoutes(router, db, { fetchImpl } = {}) {
  // Filas crudas (una por plataforma) agrupadas por título: un juego que
  // está en Steam y en Xbox sale una vez, con las horas sumadas y ambas
  // plataformas. Ver core/group-games.js.
  router.get('/api/games', (req, res) => {
    sendJson(res, 200, groupGames(gamesDb.listGames(db)));
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

  // Busca el juego en IGDB por título y guarda el tiempo para completarlo
  // del mejor match (core/igdb.pickBestMatch). El campo queda editable
  // después desde PATCH /igdb por si el match automático no es el correcto.
  router.post('/api/games/:id/igdb/search', async (req, res, params) => {
    const game = gamesDb.getGameById(db, Number(params.id));
    if (!game) return sendJson(res, 404, { error: 'juego no encontrado' });

    const credentials = { clientId: process.env.TWITCH_CLIENT_ID, clientSecret: process.env.TWITCH_CLIENT_SECRET, fetchImpl };

    try {
      const candidates = await igdbClient.searchGame(game.title, credentials);
      const match = pickBestMatch(candidates, game.title);
      if (!match) return sendJson(res, 404, { error: 'no se encontró el juego en IGDB' });

      const times = await igdbClient.getTimeToBeat(match.igdbId, credentials);

      const updated = gamesDb.setIgdbTimes(db, game.id, {
        igdbId: match.igdbId,
        mainMinutes: times.mainMinutes,
        completionistMinutes: times.completionistMinutes,
      });
      sendJson(res, 200, updated);
    } catch (err) {
      sendJson(res, 502, { error: err.message });
    }
  });

  router.patch('/api/games/:id/igdb', async (req, res, params) => {
    try {
      const game = gamesDb.getGameById(db, Number(params.id));
      if (!game) return sendJson(res, 404, { error: 'juego no encontrado' });

      const body = await readJsonBody(req);
      const clean = validateIgdbUpdate(body);
      const updated = gamesDb.setIgdbTimes(db, game.id, { igdbId: game.igdbId, ...clean });
      sendJson(res, 200, updated);
    } catch (err) {
      sendJson(res, 400, { error: err.message });
    }
  });
}

module.exports = { registerGameRoutes };
