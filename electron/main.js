const path = require('node:path');
const fs = require('node:fs');
const { app, BrowserWindow, Menu, shell } = require('electron');

// APP_ROOT es la carpeta de código: la raíz del proyecto en desarrollo, o
// resources/app.asar dentro del instalador (Electron lee de ahí de forma
// transparente, incluso en modo ELECTRON_RUN_AS_NODE). Es de solo lectura
// una vez empaquetado, así que nunca se escribe nada ahí.
const APP_ROOT = path.join(__dirname, '..');

// Los datos del usuario (.env, la base de datos, la sesión de Epic) no
// pueden vivir dentro del instalador: en desarrollo siguen en la raíz del
// proyecto (igual que "npm start"), pero empaquetado usan la carpeta de
// datos de usuario del sistema operativo (p. ej. %APPDATA%\SteamDB), que
// sí es escribible sin permisos de administrador y sobrevive a reinstalar
// una versión nueva.
function resolveDataPaths() {
  const base = app.isPackaged ? app.getPath('userData') : APP_ROOT;
  return {
    envPath: path.join(base, '.env'),
    dbPath: path.join(base, 'data', 'steamdb.sqlite'),
    epicAuthPath: path.join(base, 'data', 'epic_auth.json'),
  };
}

const paths = resolveDataPaths();

// Reutiliza el .env del usuario (mismo formato que --env-file-if-exists de
// Node, pero Electron no pasa ese flag de forma fiable a su proceso
// principal, así que se parsea a mano aquí).
function loadEnvFile(envPath) {
  if (!fs.existsSync(envPath)) return;

  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    if (key in process.env) continue;
    process.env[key] = trimmed.slice(eq + 1).trim();
  }
}

// db/connection.js, setup/env-file.js y epic/run.js leen estas variables de
// entorno para decidir dónde leer/escribir; hay que fijarlas antes de
// requerir nada de /api, /db o /setup.
process.env.STEAMDB_ENV_PATH = paths.envPath;
process.env.DB_PATH = paths.dbPath;
process.env.EPIC_AUTH_PATH = paths.epicAuthPath;

loadEnvFile(paths.envPath);

// createServer() hace su propio require de db/connection y db/migrate,
// así que el .env tiene que estar cargado antes de este require.
const { createServer } = require('../api/server');

const PORT = process.env.PORT || 3000;

function startServer() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(PORT, '127.0.0.1', () => resolve(server));
  });
}

function buildMenu(win) {
  const template = [
    {
      label: 'SteamDB',
      submenu: [
        {
          label: 'Configuración (Steam, Epic, Xbox…)',
          click: () => win.loadURL(`http://localhost:${PORT}/onboarding.html`),
        },
        { type: 'separator' },
        { role: 'quit', label: 'Salir' },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function createWindow() {
  await startServer();

  const win = new BrowserWindow({
    width: 1150,
    height: 820,
    title: 'SteamDB',
    autoHideMenuBar: true,
  });

  // Los enlaces "Abrir la página" de la bienvenida guiada (Steam, Twitch,
  // xbl.io, Epic) deben abrirse en el navegador del sistema, no como una
  // ventana nueva de Electron.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http:') || url.startsWith('https:')) shell.openExternal(url);
    return { action: 'deny' };
  });

  buildMenu(win);
  // El propio servidor decide si toca la bienvenida guiada o la biblioteca
  // (ver needsOnboarding() en api/server.js): "/" vale para las dos, igual
  // que en el navegador con "npm start".
  win.loadURL(`http://localhost:${PORT}`);
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  app.quit();
});
