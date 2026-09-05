// Genera mobile/db/migrations.js a partir de ../db/migrations/*.sql (la
// misma fuente que usa el escritorio). El móvil no puede leer ese
// directorio en tiempo de ejecución (no hay `fs.readdirSync` sobre el
// código empaquetado), así que el SQL se empaqueta como datos JS en el
// build. Correr con `npm run build:migrations` cada vez que cambie algo en
// /db/migrations — no hace falta retipear nada a mano.
const fs = require('node:fs');
const path = require('node:path');

const SOURCE_DIR = path.join(__dirname, '..', '..', 'db', 'migrations');
const OUT_FILE = path.join(__dirname, '..', 'db', 'migrations.js');

const files = fs
  .readdirSync(SOURCE_DIR)
  .filter((f) => f.endsWith('.sql'))
  .sort();

const migrations = files.map((name) => ({
  name,
  sql: fs.readFileSync(path.join(SOURCE_DIR, name), 'utf8'),
}));

const header =
  '// GENERADO por mobile/scripts/build-migrations.js a partir de /db/migrations/*.sql.\n' +
  '// No editar a mano: corre `npm run build:migrations` tras cambiar una migración.\n';

const body = `module.exports = ${JSON.stringify(migrations, null, 2)};\n`;

fs.writeFileSync(OUT_FILE, header + body);
console.log(`mobile/db/migrations.js generado con ${migrations.length} migraciones.`);
