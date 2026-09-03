const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const { app, BrowserWindow, Menu, dialog } = require('electron');

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

// Abre el mismo asistente de "npm run setup" (CLI, node:readline) en una
// consola nueva de Windows y espera a que se cierre. Se relanza el propio
// binario de Electron en modo Node (ELECTRON_RUN_AS_NODE) para no depender
// de que el usuario tenga Node instalado; "cmd /c start ... /wait" es lo
// que hace falta en Windows para que un proceso de subsistema gráfico como
// Electron.exe abra una consola visible e interactiva.
function runSetupWizardInConsole() {
  return new Promise((resolve) => {
    const setupScript = path.join(APP_ROOT, 'setup', 'run.js');
    const child = spawn(
      'cmd.exe',
      ['/c', 'start', '"SteamDB - Configuración"', '/wait', process.execPath, setupScript],
      {
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
        cwd: APP_ROOT,
        windowsHide: false,
      }
    );
    child.on('exit', () => resolve());
    child.on('error', () => resolve()); // si algo falla al abrir la consola, seguimos igual a la ventana principal
  });
}

function buildMenu(win) {
  const template = [
    {
      label: 'SteamDB',
      submenu: [
        {
          label: 'Configuración (Steam, Epic, Xbox…)',
          click: async () => {
            await runSetupWizardInConsole();
            win.reload();
          },
        },
        { type: 'separator' },
        { role: 'quit', label: 'Salir' },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function createWindow() {
  // Primera vez: sin .env no hay ni Steam configurado. Se avisa y se abre
  // el asistente antes de mostrar la ventana; si el usuario lo cierra sin
  // terminar, la app arranca igual (el resto de la app ya tolera credenciales
  // ausentes con errores claros por plataforma, no hace falta bloquear).
  if (!fs.existsSync(paths.envPath)) {
    await dialog.showMessageBox({
      type: 'info',
      title: 'Bienvenido a SteamDB',
      message: 'Antes de sincronizar tu biblioteca hace falta configurar al menos Steam.',
      detail: 'Se va a abrir una ventana de configuración guiada. Puedes cerrarla y hacerlo luego desde el menú "SteamDB → Configuración".',
      buttons: ['Continuar'],
    });
    await runSetupWizardInConsole();
    loadEnvFile(paths.envPath); // por si el wizard escribió el .env en este mismo proceso
  }

  await startServer();

  const win = new BrowserWindow({
    width: 1150,
    height: 820,
    title: 'SteamDB',
    autoHideMenuBar: true,
  });

  buildMenu(win);
  win.loadURL(`http://localhost:${PORT}`);
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  app.quit();
});
