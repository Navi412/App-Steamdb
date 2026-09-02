// Empujoncito tras `npm install`: si todavía no hay configuración, recuerda
// cuál es el siguiente paso. Nunca falla el install (pase lo que pase, sale 0).

try {
  const fs = require('node:fs');
  const path = require('node:path');
  const configured = fs.existsSync(path.join(__dirname, '..', '.env'));
  if (!configured && process.stdout.isTTY) {
    console.log('\n  Instalación lista. Siguiente paso:\n');
    console.log('      npm run setup\n');
    console.log('  (asistente guiado: te da las claves que necesitas y deja la app en marcha)\n');
  }
} catch {
  /* si algo va mal aquí, da igual: no es crítico */
}
