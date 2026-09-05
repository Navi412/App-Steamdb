// Entrypoint de "npm run sync". Separado de run.js para que run.js (y su
// runSync, que sí se reutiliza desde el móvil) no cargue node:sqlite ni
// node:fs: Metro no sabe resolver esos módulos nativos de Node, y por
// cómo empaqueta (sigue todos los require() de un fichero aunque estén en
// una rama que no se ejecute) basta con que aparezcan en el fichero para
// que falle el bundle, aunque el móvil nunca llegue a correr este bloque.
const { openDatabase } = require('../db/connection');
const { migrate } = require('../db/migrate');
const { runSync } = require('./run');

const db = openDatabase();
migrate(db);
runSync({ db, apiKey: process.env.STEAM_API_KEY, steamId: process.env.STEAM_ID })
  .then(({ gamesSynced }) => {
    console.log(`sincronizados ${gamesSynced} juegos`);
  })
  .catch((err) => {
    console.error(`fallo la sincronización: ${err.message}`);
    process.exitCode = 1;
  });
