// Cliente de Eden, emulador de Nintendo Switch. Como GOG, no habla por red:
// todo sale de la carpeta de datos que el propio emulador escribe en local.
//
// Eden no tiene una "biblioteca" con metadatos como Steam/GOG Galaxy: la
// arma leyendo las carpetas de juegos que el usuario configuró (los .nsp/
// .xci que Eden puede arrancar) y cruzando eso con dos ficheros propios:
//   - play_time/playtime.bin: contador acumulado de segundos por título.
//   - cache/launched.json: nº de arranques y fecha del último, por título.
// Ninguno de los dos trae el nombre del juego, así que el título sale del
// propio nombre de archivo del ROM (la escena de Switch los nombra como
// "Nombre del juego [TITLEID][vNNN].nsp", con el id en hexadecimal).
//
// No sabe nada de nuestra SQLite ni de qué juego de la base se trata:
// devuelve objetos planos que /db y /core entienden.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Ruta por defecto según plataforma. Se puede forzar otra con EDEN_DATA_DIR
// (por ejemplo si Eden está instalado como Flatpak, o portable).
const DEFAULT_DATA_DIR =
  process.env.EDEN_DATA_DIR ||
  (process.platform === 'win32'
    ? path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'eden')
    : process.platform === 'darwin'
      ? path.join(os.homedir(), 'Library', 'Application Support', 'eden')
      : path.join(os.homedir(), '.local', 'share', 'eden'));

const ROM_EXTENSIONS = new Set(['.nsp', '.xci', '.nsz', '.xcz']);

// Solo el título id (16 hex) entre corchetes o paréntesis: "[v0]" o
// "[v393216]" (la versión, que también va entre corchetes) no matchea
// porque "v0"/"v393216" no son 16 caracteres hexadecimales.
const TITLE_ID_RE = /[[(]([0-9A-Fa-f]{16})[\])]/;
const VERSION_SUFFIX_RE = /\s+v[\d.]+$/i;

// El id "base" de un juego siempre termina en 000 (últimos 12 bits a 0);
// la actualización es ese mismo id con esos 12 bits a 0x800, y el DLC usa
// el resto del rango. Para no duplicar el juego cuando hay ROM de la
// actualización además de la base, todo se agrupa por este id truncado.
function toBaseTitleId(hexId) {
  const id = BigInt(`0x${hexId}`);
  return (id & ~0xfffn).toString(16).toUpperCase().padStart(16, '0');
}

function isBaseTitleId(hexId) {
  return (BigInt(`0x${hexId}`) & 0xfffn) === 0n;
}

// "Nombre del juego [0100000000010000][v0].nsp" -> { titleId, title }.
// Los nombres de la escena sustituyen ':' por '_' (inválido en Windows),
// p. ej. "Paper Mario_ The Thousand-Year Door v0 (...).xci"; se deshace
// solo cuando el '_' va pegado a un espacio, para no tocar títulos que
// usan '_' de verdad.
function parseRomFileName(fileName) {
  const base = fileName.replace(/\.(nsp|xci|nsz|xcz)$/i, '');
  const idMatch = base.match(TITLE_ID_RE);
  if (!idMatch) return null;

  const bracketIndex = base.search(/[[(]/);
  let title = (bracketIndex >= 0 ? base.slice(0, bracketIndex) : base).trim();
  title = title.replace(VERSION_SUFFIX_RE, '').trim();
  title = title.replace(/_(?=\s|$)/g, ':').replace(/\s{2,}/g, ' ').trim();
  if (!title) return null;

  return { titleId: idMatch[1].toUpperCase(), title };
}

// `Paths\gamedirs\N\path` del qt-config.ini de Eden (formato QSettings:
// líneas "clave=valor"). Se ignoran 'SDMC'/'UserNAND'/'SysNAND': son
// pseudo-rutas al NAND emulado, con contenido instalado bajo nombres de
// archivo hasheados sin ningún título legible.
const GAMEDIR_RE = /^Paths\\gamedirs\\\d+\\path=(.*)$/;

function readConfiguredGameDirs(configPath) {
  if (!fs.existsSync(configPath)) return [];
  const lines = fs.readFileSync(configPath, 'utf8').split(/\r?\n/);
  const dirs = new Set();
  for (const line of lines) {
    const m = line.match(GAMEDIR_RE);
    if (!m) continue;
    const value = m[1].trim();
    if (/^[A-Za-z]:[\\/]|^\//.test(value)) dirs.add(value);
  }
  return [...dirs];
}

function walkRomFiles(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return []; // carpeta configurada que ya no existe: se ignora, no es un error fatal
  }

  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkRomFiles(full));
    } else if (ROM_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      files.push(full);
    }
  }
  return files;
}

// playtime.bin: registros de 16 bytes, sin cabecera — 8 bytes little-endian
// con el título id + 8 bytes little-endian con el contador en SEGUNDOS.
// (Calibrado a mano contra el "Play time" que enseña el propio Eden: un
// valor crudo de 780 correspondía a ~13 minutos jugados.)
function readPlaytimeMinutes(filePath) {
  const minutesByBaseId = new Map();
  if (!fs.existsSync(filePath)) return minutesByBaseId;

  const buf = fs.readFileSync(filePath);
  const RECORD_SIZE = 16;
  for (let offset = 0; offset + RECORD_SIZE <= buf.length; offset += RECORD_SIZE) {
    const titleId = buf.readBigUInt64LE(offset);
    const seconds = buf.readBigUInt64LE(offset + 8);
    const baseId = (titleId & ~0xfffn).toString(16).toUpperCase().padStart(16, '0');
    const minutes = Math.round(Number(seconds) / 60);
    minutesByBaseId.set(baseId, (minutesByBaseId.get(baseId) || 0) + minutes);
  }
  return minutesByBaseId;
}

// cache/launched.json: { "<titleId>": { launch_count, timestamp (unix, s) } }.
function readLastPlayed(filePath) {
  const lastPlayedByBaseId = new Map();
  if (!fs.existsSync(filePath)) return lastPlayedByBaseId;

  let data;
  try {
    data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return lastPlayedByBaseId; // fichero corrupto o a medio escribir: se ignora
  }

  for (const [rawId, info] of Object.entries(data ?? {})) {
    if (!/^[0-9A-Fa-f]{16}$/.test(rawId)) continue;
    const ts = Number(info?.timestamp);
    if (!Number.isFinite(ts)) continue;

    const baseId = toBaseTitleId(rawId);
    const iso = new Date(ts * 1000).toISOString();
    const prev = lastPlayedByBaseId.get(baseId);
    if (!prev || iso > prev) lastPlayedByBaseId.set(baseId, iso);
  }
  return lastPlayedByBaseId;
}

// Lee la biblioteca de Eden y la devuelve ya masticada:
//   { games: [{ edenId, title, minutes, lastPlayed }], skipped: [...] }
function readEdenLibrary({ dataDir = DEFAULT_DATA_DIR } = {}) {
  if (!fs.existsSync(dataDir)) {
    throw new Error(
      `no se encontró la carpeta de datos de Eden en ${dataDir}. ` +
        '¿Está instalado Eden y se ha ejecutado al menos una vez? Si está en otra ruta, define EDEN_DATA_DIR en el .env.'
    );
  }

  const gameDirs = readConfiguredGameDirs(path.join(dataDir, 'config', 'qt-config.ini'));
  const minutesByBaseId = readPlaytimeMinutes(path.join(dataDir, 'play_time', 'playtime.bin'));
  const lastPlayedByBaseId = readLastPlayed(path.join(dataDir, 'cache', 'launched.json'));

  // baseId -> { title, isBase }. `isBase` decide quién da el título cuando
  // hay ROM de la base y de la actualización del mismo juego a la vez.
  const byBaseId = new Map();
  const skipped = [];

  for (const dir of gameDirs) {
    for (const file of walkRomFiles(dir)) {
      const parsed = parseRomFileName(path.basename(file));
      if (!parsed) {
        skipped.push({ file: path.basename(file), path: file });
        continue;
      }

      const baseId = toBaseTitleId(parsed.titleId);
      const isBase = isBaseTitleId(parsed.titleId);
      const existing = byBaseId.get(baseId);
      if (!existing || (isBase && !existing.isBase)) {
        byBaseId.set(baseId, { title: parsed.title, isBase });
      }
    }
  }

  // Título con horas o "última vez jugado" pero sin ROM ya en las carpetas
  // configuradas (se borró tras jugarlo, o se movió): se conserva con el
  // id como título provisional en vez de perder las horas que Eden ya
  // había contabilizado.
  for (const baseId of new Set([...minutesByBaseId.keys(), ...lastPlayedByBaseId.keys()])) {
    if (!byBaseId.has(baseId)) {
      byBaseId.set(baseId, { title: `Switch ${baseId}`, isBase: false });
    }
  }

  const games = [...byBaseId.entries()].map(([baseId, info]) => ({
    edenId: baseId,
    title: info.title,
    minutes: minutesByBaseId.get(baseId) || 0,
    lastPlayed: lastPlayedByBaseId.get(baseId) || null,
  }));

  return { games, skipped };
}

module.exports = { readEdenLibrary, DEFAULT_DATA_DIR };
