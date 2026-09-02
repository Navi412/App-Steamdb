const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { parseEnv, renderEnv, writeEnv } = require('../setup/env-file');

const TEMPLATE = [
  '# Clave de Steam',
  'STEAM_API_KEY=',
  '',
  '# SteamID64',
  'STEAM_ID=',
  '',
  '# Puerto (opcional)',
  'PORT=3000',
  '',
].join('\n');

test('parseEnv ignora blancos y comentarios y parte por el primer "="', () => {
  const parsed = parseEnv('# hola\n\nA=1\nB = dos = tres \n#C=no');
  assert.deepEqual(parsed, { A: '1', B: 'dos = tres' });
});

test('renderEnv conserva los comentarios de la plantilla y rellena los valores', () => {
  const out = renderEnv({ STEAM_API_KEY: 'abc', STEAM_ID: '765', PORT: '3000' }, TEMPLATE);
  assert.match(out, /# Clave de Steam\nSTEAM_API_KEY=abc\n/);
  assert.match(out, /# SteamID64\nSTEAM_ID=765\n/);
  assert.match(out, /PORT=3000\n$/);
});

test('renderEnv deja la clave vacía cuando no hay valor', () => {
  const out = renderEnv({ STEAM_API_KEY: 'abc' }, TEMPLATE);
  assert.match(out, /STEAM_ID=\n/);
});

test('renderEnv respeta el valor de la plantilla para una clave que no se tocó', () => {
  const out = renderEnv({ STEAM_API_KEY: 'abc' }, TEMPLATE);
  assert.match(out, /PORT=3000\n/); // PORT no está en values -> se deja como estaba
});

test('renderEnv sí vacía una clave con valor "" explícito', () => {
  const out = renderEnv({ PORT: '' }, TEMPLATE);
  assert.match(out, /PORT=\n/);
});

test('renderEnv añade al final las claves que la plantilla no menciona', () => {
  const out = renderEnv({ STEAM_API_KEY: 'abc', EXTRA_KEY: 'x' }, TEMPLATE);
  assert.match(out, /\nEXTRA_KEY=x\n$/);
});

test('renderEnv no arrastra claves extra vacías', () => {
  const out = renderEnv({ STEAM_API_KEY: 'abc', EXTRA_KEY: '' }, TEMPLATE);
  assert.doesNotMatch(out, /EXTRA_KEY/);
});

test('writeEnv escribe el .env y hace copia previa a .env.bak si ya existía', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'steamdb-env-'));
  const envPath = path.join(dir, '.env');
  const templatePath = path.join(dir, '.env.example');
  fs.writeFileSync(templatePath, TEMPLATE);
  fs.writeFileSync(envPath, 'STEAM_API_KEY=viejo\nSTEAM_ID=viejo\nPORT=3000\n');

  const { backup } = writeEnv(
    { STEAM_API_KEY: 'nuevo', STEAM_ID: '765', PORT: '3000' },
    { envPath, templatePath }
  );

  assert.equal(backup, `${envPath}.bak`);
  assert.match(fs.readFileSync(`${envPath}.bak`, 'utf8'), /STEAM_API_KEY=viejo/);
  const written = fs.readFileSync(envPath, 'utf8');
  assert.match(written, /STEAM_API_KEY=nuevo/);
  assert.match(written, /# Clave de Steam/);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('writeEnv no crea copia si no había .env previo', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'steamdb-env-'));
  const envPath = path.join(dir, '.env');
  const templatePath = path.join(dir, '.env.example');
  fs.writeFileSync(templatePath, TEMPLATE);

  const { backup } = writeEnv({ STEAM_API_KEY: 'x' }, { envPath, templatePath });

  assert.equal(backup, null);
  assert.ok(fs.existsSync(envPath));
  assert.ok(!fs.existsSync(`${envPath}.bak`));

  fs.rmSync(dir, { recursive: true, force: true });
});
