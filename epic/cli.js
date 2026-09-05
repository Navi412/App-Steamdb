// Entrypoint de "npm run sync:epic" y "npm run epic:login <código>".
// Separado de run.js por lo mismo que sync/cli.js y xbox/cli.js: run.js
// (reutilizado desde el móvil) no debe tocar node:fs ni node:sqlite.
const { openDatabase } = require('../db/connection');
const { migrate } = require('../db/migrate');
const { runEpicSync, loginWithCode } = require('./run');
const { fileAuthStore } = require('./file-auth-store');

const [cmd, arg] = process.argv.slice(2);

if (cmd === 'login') {
  if (!arg) {
    console.error('uso: npm run epic:login <código de autorización>');
    process.exit(1);
  }
  loginWithCode(arg, { authStore: fileAuthStore() })
    .then((accountId) => console.log(`Epic: sesión guardada (cuenta ${accountId}). Ya puedes correr "npm run sync:epic".`))
    .catch((err) => {
      console.error(`Epic login falló: ${err.message}`);
      process.exitCode = 1;
    });
} else {
  const db = openDatabase();
  migrate(db);
  runEpicSync({ db, authStore: fileAuthStore() })
    .then((r) => console.log(`Epic: ${r.added} nuevos, ${r.updated} con horas nuevas, ${r.skipped} descartados`))
    .catch((err) => {
      console.error(`falló la sincronización de Epic: ${err.message}`);
      process.exitCode = 1;
    });
}
