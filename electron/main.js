const path = require('node:path');
const fs = require('node:fs');
const { app, BrowserWindow } = require('electron');

// Reutiliza el .env del proyecto (mismo formato que --env-file-if-exists de
// Node, pero Electron no pasa ese flag de forma fiable a su proceso
// principal, así que se parsea a mano aquí).
function loadEnvFile() {
  const envPath = path.join(__dirname, '..', '.env');
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

loadEnvFile();

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

async function createWindow() {
  await startServer();

  const win = new BrowserWindow({
    width: 1150,
    height: 820,
    title: 'SteamDB',
    autoHideMenuBar: true,
  });

  win.loadURL(`http://localhost:${PORT}`);
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  app.quit();
});
