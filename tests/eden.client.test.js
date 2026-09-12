const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readEdenLibrary } = require('../eden/client');

// Construye una carpeta de datos de Eden mínima: qt-config.ini con las
// carpetas de juegos indicadas, los ROMs (vacíos, solo importa el nombre)
// dentro de ellas, y opcionalmente playtime.bin/launched.json.
function makeEdenDataDir({ gameDirs = ['roms'], files = [], playtime = [], launched = null } = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'steamdb-eden-fixture-'));

  const resolvedDirs = gameDirs.map((d) => {
    if (d === 'SDMC' || d === 'UserNAND' || d === 'SysNAND') return d;
    const full = path.join(dataDir, d);
    fs.mkdirSync(full, { recursive: true });
    return full.replace(/\\/g, '/');
  });

  const configDir = path.join(dataDir, 'config');
  fs.mkdirSync(configDir, { recursive: true });
  const gamedirLines = resolvedDirs.map((p, i) => `Paths\\gamedirs\\${i + 1}\\path=${p}`);
  fs.writeFileSync(
    path.join(configDir, 'qt-config.ini'),
    ['[UI]', 'Paths\\gamedirs\\size=' + resolvedDirs.length, ...gamedirLines, ''].join('\n')
  );

  for (const file of files) {
    const dir = path.join(dataDir, file.dir ?? 'roms');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, file.name), '');
  }

  if (playtime.length > 0) {
    const ptDir = path.join(dataDir, 'play_time');
    fs.mkdirSync(ptDir, { recursive: true });
    const buf = Buffer.alloc(playtime.length * 16);
    playtime.forEach((rec, i) => {
      buf.writeBigUInt64LE(BigInt(`0x${rec.titleId}`), i * 16);
      buf.writeBigUInt64LE(BigInt(rec.seconds), i * 16 + 8);
    });
    fs.writeFileSync(path.join(ptDir, 'playtime.bin'), buf);
  }

  if (launched) {
    const cacheDir = path.join(dataDir, 'cache');
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(path.join(cacheDir, 'launched.json'), JSON.stringify(launched));
  }

  return dataDir;
}

test('saca el título y el id del nombre del archivo ROM', () => {
  const dataDir = makeEdenDataDir({
    files: [{ name: 'Super Mario Odyssey [0100000000010000][v0].nsp' }],
  });

  const { games } = readEdenLibrary({ dataDir });
  assert.equal(games.length, 1);
  assert.equal(games[0].edenId, '0100000000010000');
  assert.equal(games[0].title, 'Super Mario Odyssey');
  assert.equal(games[0].minutes, 0);
  assert.equal(games[0].lastPlayed, null);
});

test('deshace el "_" por ":" solo cuando sustituye a un carácter inválido en el nombre', () => {
  const dataDir = makeEdenDataDir({
    files: [{ name: 'Paper Mario_ The Thousand-Year Door v0 (0100ECD018EBE000).xci' }],
  });

  const { games } = readEdenLibrary({ dataDir });
  assert.equal(games[0].title, 'Paper Mario: The Thousand-Year Door');
});

test('la ROM de la actualización se funde con la base bajo el mismo id truncado', () => {
  const dataDir = makeEdenDataDir({
    files: [
      { name: 'Super Mario Odyssey [0100000000010000][v0].nsp' },
      { name: 'SUPER MARIO ODYSSEY v1.4.1 [0100000000010800][v393216].nsp' },
    ],
  });

  const { games } = readEdenLibrary({ dataDir });
  assert.equal(games.length, 1);
  // El título lo da la base (id que termina en 000), no la actualización.
  assert.equal(games[0].title, 'Super Mario Odyssey');
  assert.equal(games[0].edenId, '0100000000010000');
});

test('un archivo sin id de título reconocible va a "skipped", no a "games"', () => {
  const dataDir = makeEdenDataDir({
    files: [{ name: 'readme.nsp' }, { name: 'Super Mario Odyssey [0100000000010000][v0].nsp' }],
  });

  const { games, skipped } = readEdenLibrary({ dataDir });
  assert.equal(games.length, 1);
  assert.deepEqual(skipped.map((s) => s.file), ['readme.nsp']);
});

test('las carpetas mágicas del NAND (SDMC/UserNAND/SysNAND) no se escanean', () => {
  const dataDir = makeEdenDataDir({ gameDirs: ['SDMC', 'UserNAND', 'roms'], files: [] });
  const { games } = readEdenLibrary({ dataDir });
  assert.deepEqual(games, []);
});

test('las horas salen de playtime.bin, en segundos redondeados a minutos', () => {
  const dataDir = makeEdenDataDir({
    files: [{ name: 'Paper Mario_ The Thousand-Year Door v0 (0100ECD018EBE000).xci' }],
    playtime: [{ titleId: '0100ECD018EBE000', seconds: 780 }],
  });

  const { games } = readEdenLibrary({ dataDir });
  assert.equal(games[0].minutes, 13);
});

test('la última vez jugado sale de launched.json', () => {
  const dataDir = makeEdenDataDir({
    files: [{ name: 'Super Mario Odyssey [0100000000010000][v0].nsp' }],
    launched: { '0100000000010000': { launch_count: 2, timestamp: 1789229650 } },
  });

  const { games } = readEdenLibrary({ dataDir });
  assert.equal(games[0].lastPlayed, new Date(1789229650 * 1000).toISOString());
});

test('un juego con horas registradas pero sin ROM ya en disco se conserva con la id como título provisional', () => {
  const dataDir = makeEdenDataDir({
    files: [],
    playtime: [{ titleId: '0100ECD018EBE000', seconds: 780 }],
  });

  const { games } = readEdenLibrary({ dataDir });
  assert.equal(games.length, 1);
  assert.equal(games[0].edenId, '0100ECD018EBE000');
  assert.equal(games[0].title, 'Switch 0100ECD018EBE000');
  assert.equal(games[0].minutes, 13);
});

test('si no existe la carpeta de datos de Eden, lanza un error claro', () => {
  assert.throws(
    () => readEdenLibrary({ dataDir: path.join(os.tmpdir(), 'no-hay-eden-aqui') }),
    /Eden/
  );
});
