// Entrypoint de "npm run sync:xbox". Separado de run.js por lo mismo que
// sync/cli.js: run.js (y su runXboxSync, reutilizado desde el móvil) no
// debe cargar node:sqlite ni node:fs, que Metro no sabe resolver.
const { openDatabase } = require('../db/connection');
const { migrate } = require('../db/migrate');
const { runXboxSync } = require('./run');

const db = openDatabase();
migrate(db);
runXboxSync({ db, apiKey: process.env.OPENXBL_API_KEY })
  .then((r) => {
    console.log(
      `Xbox: ${r.gamesSynced} en el historial | ${r.added} nuevos, ${r.updated} con horas nuevas, ` +
        `${r.skipped} sin cambios/sin dato`
    );
    if (r.stoppedEarly) {
      console.log(
        `\nSe alcanzó el límite de OpenXBL con ${r.pending} juegos aún por procesar. ` +
          `Vuelve a correr "npm run sync:xbox" dentro de una hora para terminar.`
      );
    }
  })
  .catch((err) => {
    console.error(`falló la sincronización de Xbox: ${err.message}`);
    process.exitCode = 1;
  });
