const path = require('node:path');
const fs = require('node:fs');
const { openDatabase } = require('./connection');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

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

  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith('.sql'))
    .sort()
    .filter((file) => !applied.has(file));
}

function migrate(db) {
  const pending = pendingMigrations(db);
  if (pending.length === 0) return pending;

  // Algunas migraciones reconstruyen tablas con hijos que las referencian
  // (p. ej. 005 rehace `games`). SQLite solo deja hacerlo con las FK
  // desactivadas, y `PRAGMA foreign_keys` es un no-op dentro de una
  // transacción, así que se conmuta aquí fuera, alrededor de todo el lote.
  const fkOn = db.prepare('PRAGMA foreign_keys').get().foreign_keys === 1;
  if (fkOn) db.exec('PRAGMA foreign_keys = OFF');

  try {
    for (const file of pending) {
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
      db.exec('BEGIN');
      try {
        db.exec(sql);
        db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(
          file,
          new Date().toISOString()
        );
        db.exec('COMMIT');
        console.log(`aplicada: ${file}`);
      } catch (err) {
        db.exec('ROLLBACK');
        throw new Error(`fallo al aplicar la migración ${file}: ${err.message}`);
      }
    }
  } finally {
    if (fkOn) db.exec('PRAGMA foreign_keys = ON');
  }

  return pending;
}

if (require.main === module) {
  const db = openDatabase();
  const applied = migrate(db);
  if (applied.length === 0) {
    console.log('nada que migrar');
  }
}

module.exports = { migrate };
