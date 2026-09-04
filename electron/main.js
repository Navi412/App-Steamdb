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
// datos de usuario del sistema operativo (p. ej. %APPDATA%\Backlog), que sí
// es escribible sin permisos de administrador y sobrevive a reinstalar una
// versión nueva.
function resolveDataPaths() {
  const base = app.isPackaged ? app.getPath('userData') : APP_ROOT;
  if (app.isPackaged) migrateLegacyUserData(base);
  return {
    envPath: path.join(base, '.env'),
    dbPath: path.join(base, 'data', 'steamdb.sqlite'),
    epicAuthPath: path.join(base, 'data', 'epic_auth.json'),
  };
}

// La app se llamaba "SteamDB": quien la tuviera instalada con ese nombre
// tiene su .env y su base de datos en %APPDATA%\SteamDB. Si ya hay datos en
// la carpeta nueva no se toca nada; si no, se copian (nunca se mueven, para
// no arriesgar el original) antes de que el resto de la app los busque.
function migrateLegacyUserData(newBase) {
  if (fs.existsSync(path.join(newBase, '.env'))) return;
  const legacyBase = path.join(path.dirname(newBase), 'SteamDB');
  if (legacyBase === newBase || !fs.existsSync(legacyBase)) return;

  fs.mkdirSync(newBase, { recursive: true });
  for (const item of ['.env', 'data']) {
    const from = path.join(legacyBase, item);
    const to = path.join(newBase, item);
    if (fs.existsSync(from) && !fs.existsSync(to)) {
      fs.cpSync(from, to, { recursive: true });
    }
  }
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
      label: 'Backlog',
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
    title: 'Backlog',
    autoHideMenuBar: true,
    // En Windows empaquetado el .exe ya lleva este icono (build.win.icon);
    // esto es sobre todo para que "npm run electron" en desarrollo no
    // enseñe el icono genérico de Electron.
    icon: path.join(APP_ROOT, 'build', 'icon.ico'),
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
