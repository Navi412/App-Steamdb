const { GROUPS, allKeys } = require('../../setup/fields');
const { readEnv, writeEnv } = require('../../setup/env-file');
const validate = require('../../setup/validate');
const { readJsonBody, sendJson } = require('../http-helpers');

// Mismos validadores "en vivo" que usa `npm run setup`: cada uno llama a la
// API real de la plataforma. Epic no entra aquí — no tiene campos de .env,
// se resuelve con el canje de código de /api/setup/epic/redeem.
function buildValidators(fetchImpl) {
  return {
    steam: (v) => validate.validateSteam({ apiKey: v.STEAM_API_KEY, steamId: v.STEAM_ID, fetchImpl }),
    igdb: (v) => validate.validateIgdb({ clientId: v.TWITCH_CLIENT_ID, clientSecret: v.TWITCH_CLIENT_SECRET, fetchImpl }),
    xbox: (v) => validate.validateOpenXbl({ apiKey: v.OPENXBL_API_KEY, fetchImpl }),
  };
}

const SECRET_KEYS = new Set(GROUPS.flatMap((g) => (g.fields || []).filter((f) => f.secret).map((f) => f.key)));

// Igual que el wizard de terminal: se ve el final del valor, no el valor
// entero, para que compartir pantalla o una captura no filtre la clave.
function maskValue(v) {
  if (!v) return '';
  if (v.length <= 4) return '****';
  return `${'*'.repeat(Math.min(8, v.length - 4))}${v.slice(-4)}`;
}

function registerSetupRoutes(router, { fetchImpl, epicAuthPath, envPath } = {}) {
  const validators = buildValidators(fetchImpl);

  // Metadatos de los pasos (títulos, campos, enlaces, guía en lenguaje
  // llano): la misma fuente que lee `npm run setup`, para no mantener la
  // copia dos veces.
  router.get('/api/setup/fields', (req, res) => {
    sendJson(res, 200, { groups: GROUPS });
  });

  // Qué hay guardado ahora mismo, enmascarado si es secreto, más el estado
  // de la sesión de Epic (que no vive en .env sino en su propio fichero).
  router.get('/api/setup/status', async (req, res) => {
    const stored = readEnv(envPath);
    const values = {};
    for (const key of allKeys()) {
      const raw = process.env[key] || stored[key] || '';
      values[key] = { filled: Boolean(raw), display: raw ? (SECRET_KEYS.has(key) ? maskValue(raw) : raw) : '' };
    }
    const epic = await validate.validateEpic({ authPath: epicAuthPath, fetchImpl });
    sendJson(res, 200, { values, epic: { ok: epic.ok, detail: epic.ok ? epic.detail : null } });
  });

  // Comprueba un grupo contra la API real sin guardar nada todavía (igual
  // que el wizard: primero se valida, luego se decide si se guarda).
  router.post('/api/setup/validate', async (req, res) => {
    try {
      const body = await readJsonBody(req);
      const groupId = body.groupId;
      const group = GROUPS.find((g) => g.id === groupId);
      if (!group) return sendJson(res, 400, { error: 'grupo desconocido' });

      const merged = { ...readEnv(envPath), ...(body.values || {}) };

      let resolvedSteamId = null;
      if (groupId === 'steam' && merged.STEAM_ID) {
        const resolved = await validate.resolveSteamId(merged.STEAM_ID, { apiKey: merged.STEAM_API_KEY, fetchImpl });
        if (!resolved.steamId) return sendJson(res, 200, { ok: false, error: resolved.error });
        merged.STEAM_ID = resolved.steamId;
        resolvedSteamId = resolved.steamId;
      }

      const validator = validators[groupId];
      if (!validator) return sendJson(res, 400, { error: 'este grupo no se valida contra una API' });

      const result = await validator(merged);
      sendJson(res, 200, { ...result, steamId: resolvedSteamId });
    } catch (err) {
      sendJson(res, 400, { error: err.message });
    }
  });

  // Guarda en .env (con copia de seguridad, igual que el wizard) y lo deja
  // disponible al momento en este mismo proceso: así /api/sync ya lo ve sin
  // reiniciar la app.
  router.post('/api/setup/save', async (req, res) => {
    try {
      const body = await readJsonBody(req);
      const incoming = body.values || {};
      const merged = { ...readEnv(envPath), ...incoming };
      writeEnv(merged, { envPath });
      for (const [key, value] of Object.entries(incoming)) {
        if (value) process.env[key] = value;
        else delete process.env[key];
      }
      sendJson(res, 200, { ok: true });
    } catch (err) {
      sendJson(res, 400, { error: err.message });
    }
  });

  // Epic no usa .env: el código de autorización se canjea por un refresh
  // token que queda guardado en data/epic_auth.json.
  router.post('/api/setup/epic/redeem', async (req, res) => {
    try {
      const body = await readJsonBody(req);
      const code = validate.extractEpicCode(body.text || '');
      if (!code) return sendJson(res, 400, { error: 'pega el código de autorización de Epic' });
      const result = await validate.activateEpic(code, { authPath: epicAuthPath, fetchImpl });
      sendJson(res, 200, result);
    } catch (err) {
      sendJson(res, 400, { error: err.message });
    }
  });
}

module.exports = { registerSetupRoutes };
