const { spawn } = require('node:child_process');

// Abre una URL en el navegador por defecto del sistema. Best-effort: si algo
// falla (sin entorno gráfico, comando ausente...) se ignora y el wizard
// sigue mostrando el enlace para copiarlo a mano.
function openUrl(url) {
  try {
    let cmd;
    let args;
    if (process.platform === 'win32') {
      cmd = 'cmd';
      args = ['/c', 'start', '', url]; // el '' es el título de ventana que `start` espera
    } else if (process.platform === 'darwin') {
      cmd = 'open';
      args = [url];
    } else {
      cmd = 'xdg-open';
      args = [url];
    }
    const child = spawn(cmd, args, { stdio: 'ignore', detached: true });
    child.on('error', () => {});
    child.unref();
    return true;
  } catch {
    return false;
  }
}

module.exports = { openUrl };
