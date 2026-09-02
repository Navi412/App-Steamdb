const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
// STEAMDB_ENV_PATH permite apuntar el asistente a otro fichero (pruebas, o
// varias configuraciones); por defecto es el .env del proyecto.
const ENV_PATH = process.env.STEAMDB_ENV_PATH || path.join(ROOT, '.env');
const ENV_EXAMPLE_PATH = path.join(ROOT, '.env.example');

// Parsea líneas "CLAVE=valor" ignorando blancos y comentarios (#). Devuelve
// un objeto plano. No interpreta comillas ni escapes: los valores de este
// proyecto (claves de API, IDs numéricos, un puerto) no los necesitan.
function parseEnv(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    out[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return out;
}

function readEnv(envPath = ENV_PATH) {
  if (!fs.existsSync(envPath)) return {};
  return parseEnv(fs.readFileSync(envPath, 'utf8'));
}

// Reescribe el .env tomando .env.example como plantilla: así los
// comentarios que explican de dónde sale cada clave viajan siempre con el
// fichero. Las líneas "CLAVE=" de la plantilla se rellenan con `values`;
// cualquier clave de `values` que la plantilla no mencione se añade al
// final.
function renderEnv(values, templateText) {
  const seen = new Set();
  const lines = templateText.split(/\r?\n/).map((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return line;
    const eq = trimmed.indexOf('=');
    if (eq === -1) return line;
    const key = trimmed.slice(0, eq).trim();
    seen.add(key);
    // Clave que el wizard no tocó: se deja la línea de la plantilla tal
    // cual (así un PORT=3000 de ejemplo sobrevive a un "omitir"). Solo se
    // reescribe cuando hay un valor (o un '' explícito) en `values`.
    if (!(key in values)) return line;
    return `${key}=${values[key] != null ? values[key] : ''}`;
  });

  const extra = Object.keys(values).filter(
    (k) => !seen.has(k) && values[k] != null && values[k] !== ''
  );
  if (extra.length) {
    if (lines[lines.length - 1] !== '') lines.push('');
    for (const k of extra) lines.push(`${k}=${values[k]}`);
  }

  return lines.join('\n').replace(/\s*$/, '\n');
}

// Escribe el .env. Si ya existía, primero lo copia a .env.bak para no
// perder nada si el usuario se equivoca en el wizard.
function writeEnv(values, { envPath = ENV_PATH, templatePath = ENV_EXAMPLE_PATH } = {}) {
  const template = fs.existsSync(templatePath)
    ? fs.readFileSync(templatePath, 'utf8')
    : Object.keys(values)
        .map((k) => `${k}=`)
        .join('\n');

  let backup = null;
  if (fs.existsSync(envPath)) {
    backup = `${envPath}.bak`;
    fs.copyFileSync(envPath, backup);
  }
  fs.writeFileSync(envPath, renderEnv(values, template));
  return { envPath, backup };
}

module.exports = { parseEnv, readEnv, renderEnv, writeEnv, ENV_PATH, ENV_EXAMPLE_PATH };
