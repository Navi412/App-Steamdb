// Mismo algoritmo que ../../db/migrate.js (tabla schema_migrations,
// transacción por migración, FK desactivadas mientras dura el lote), pero
// las migraciones vienen ya empaquetadas como datos (ver
// mobile/scripts/build-migrations.js) en vez de leerse del disco: el móvil
// no puede hacer `fs.readdirSync` sobre el código fuente empaquetado.
const MIGRATIONS = require('./migrations');

function pendingMigrations(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version     TEXT PRIMARY KEY,
      applied_at  TEXT NOT NULL
    )
  `);

  const applied = new Set(
    db.prepare('SELECT version FROM schema_migrations').all().map((row) => row.version)
  );

  return MIGRATIONS.filter((m) => !applied.has(m.name));
}

function migrate(db) {
  const pending = pendingMigrations(db);
  if (pending.length === 0) return pending;

  const fkOn = db.prepare('PRAGMA foreign_keys').get().foreign_keys === 1;
  if (fkOn) db.exec('PRAGMA foreign_keys = OFF');

  try {
    for (const { name, sql } of pending) {
      db.exec('BEGIN');
      try {
        db.exec(sql);
        db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(
          name,
          new Date().toISOString()
        );
        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw new Error(`fallo al aplicar la migración ${name}: ${err.message}`);
      }
    }
  } finally {
    if (fkOn) db.exec('PRAGMA foreign_keys = ON');
  }

  return pending;
}

module.exports = { migrate };
