// Mismo contrato que ../../db/connection.js (node:sqlite DatabaseSync),
// respaldado por expo-sqlite: el resto de /db (games.js, snapshots.js,
// sessions.js, achievements.js, covers.js, external-ids.js,
// sync-anomalies.js, sync-runs.js, to-play.js) se importa tal cual desde
// el proyecto de escritorio sin modificar una sola línea, porque solo
// llaman a `db.exec(sql)` y `db.prepare(sql).run/get/all(...params)` —
// exactamente lo que expone este adaptador.
const DEFAULT_DB_NAME = 'backlog.db';

// node:sqlite usa `undefined` para "sin fila"; expo-sqlite usa `null`.
// Se normaliza aquí para que db/games.js (`if (!row) return null`, etc.)
// se comporte igual en los dos sitios.
function normalizeRow(row) {
  return row === null ? undefined : row;
}

function wrapNativeDb(native) {
  return {
    exec(sql) {
      native.execSync(sql);
    },
    prepare(sql) {
      return {
        run(...params) {
          const result = native.runSync(sql, ...params);
          return { changes: result.changes, lastInsertRowid: result.lastInsertRowId };
        },
        get(...params) {
          return normalizeRow(native.getFirstSync(sql, ...params));
        },
        all(...params) {
          return native.getAllSync(sql, ...params);
        },
      };
    },
    close() {
      native.closeSync();
    },
  };
}

// `sqliteImpl` es inyectable (mismo patrón que `fetchImpl` en /sync,
// /xbox, /epic) para poder probar el adaptador con node:sqlite real en
// vez de expo-sqlite, que no corre fuera de una app RN/Expo.
function openDatabase(dbName = DEFAULT_DB_NAME, { sqliteImpl } = {}) {
  const SQLite = sqliteImpl || require('expo-sqlite');
  const native = SQLite.openDatabaseSync(dbName);
  const db = wrapNativeDb(native);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  return db;
}

module.exports = { openDatabase, wrapNativeDb, DEFAULT_DB_NAME };
