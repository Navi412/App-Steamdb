// authStore de Epic respaldado en fichero — lo usa el escritorio (CLI,
// /api, el asistente de setup). Separado de epic/run.js a propósito: ese
// módulo también lo requiere el móvil (ver mobile/App.js), que no tiene
// node:fs, y Metro empaqueta cualquier require() que aparezca en un
// fichero aunque esté en una rama que nunca se ejecute ahí. Por eso
// run.js no puede tocar `fs` ni `path` ni de pasada, y el store por
// defecto vive aquí en su lugar.
const fs = require('node:fs');
const path = require('node:path');

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

function fileAuthStore(authPath = DEFAULT_AUTH_PATH) {
  return {
    load: () => loadAuth(authPath),
    save: (token) => saveAuth(authPath, token),
  };
}

module.exports = { loadAuth, saveAuth, fileAuthStore, DEFAULT_AUTH_PATH };
