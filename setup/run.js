const readlinePromises = require('node:readline/promises');
const { Writable } = require('node:stream');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

// Antes que nada: si el Node del usuario no sirve, cortar con un mensaje
// claro en vez de reventar más abajo al cargar node:sqlite.
require('./check-node').ensureNodeOk({ silent: true });

const { GROUPS } = require('./fields');
const { readEnv, writeEnv } = require('./env-file');
const { openUrl } = require('./open-url');
const validate = require('./validate');

const PROJECT_ROOT = path.join(__dirname, '..');

// ── salida con un poco de color, solo si la terminal lo admite ────────────
const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code, s) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);
const bold = (s) => paint('1', s);
const dim = (s) => paint('2', s);
const green = (s) => paint('32', s);
const red = (s) => paint('31', s);
const yellow = (s) => paint('33', s);
const cyan = (s) => paint('36', s);

const OK = green('✔');
const BAD = red('✗');

function heading(text) {
  console.log(`\n${bold(`━━ ${text} ${'━'.repeat(Math.max(2, 60 - text.length))}`)}`);
}
function guide(lines) {
  for (const line of lines) console.log(dim(`  ${line}`));
}

// Enmascara "****" solo el valor de una clave, dejando ver los últimos 4.
function maskValue(v) {
  if (!v) return dim('(vacío)');
  if (v.length <= 4) return '****';
  return `${'*'.repeat(Math.min(8, v.length - 4))}${v.slice(-4)}`;
}

// Limpia lo que el usuario pega: espacios, comillas o < > que rodean el
// valor, y un "CLAVE=" al principio si copió la línea entera del .env.
function cleanAnswer(raw, field) {
  let v = String(raw ?? '').trim();
  v = v.replace(/^['"<\s]+/, '').replace(/['">\s]+$/, '');
  if (field?.key) {
    v = v.replace(new RegExp(`^${field.key}\\s*=\\s*`), '').trim();
  }
  return v.replace(/\s+/g, ''); // ninguna de las claves/URLs que se piden lleva espacios
}

// ── prompt, con opción de ocultar lo que se teclea ───────────────────────
// Se usa readline/promises para que la pausa/reanudación del stream entre
// preguntas la gestione Node (con el patrón callback + Promise a mano, la
// entrada por tubería se pierde entre una pregunta y la siguiente).
function createPrompter() {
  const input = process.stdin;
  const output = process.stdout;
  const rl = readlinePromises.createInterface({ input, output });
  // Sumidero para no hacer eco de un valor secreto mientras se teclea:
  // readline escribe todo por `rl.output`, así que se sustituye por esto
  // durante esa pregunta y se restaura después.
  const sink = new Writable({ write: (_chunk, _enc, cb) => cb() });

  rl.on('SIGINT', () => {
    output.write('\n');
    console.log(dim('cancelado, no se ha escrito nada.'));
    process.exit(1);
  });

  async function question(query, { mask = false } = {}) {
    if (!mask || !output.isTTY) return rl.question(query);

    output.write(query);
    rl.output = sink; // no se verá lo tecleado (patrón tipo sudo/ssh)
    try {
      return await rl.question('');
    } finally {
      rl.output = output;
      output.write('\n');
    }
  }

  return { question, close: () => rl.close() };
}

async function askYesNo(prompter, query, defaultYes) {
  const hint = defaultYes ? '[S/n]' : '[s/N]';
  const answer = (await prompter.question(`${query} ${hint} `)).trim().toLowerCase();
  if (!answer) return defaultYes;
  return answer === 's' || answer === 'si' || answer === 'sí' || answer === 'y' || answer === 'yes';
}

// Muestra el enlace de un paso y, si el usuario lo pidió, lo abre.
function showLink(url, autoOpen) {
  if (!url) return;
  console.log(`  ${cyan('🔗 ' + url)}`);
  if (autoOpen) {
    openUrl(url);
    console.log(dim('  (abriéndolo en tu navegador…)'));
  }
}

// ── validación por grupo ────────────────────────────────────────────────
const GROUP_VALIDATORS = {
  steam: (v) => validate.validateSteam({ apiKey: v.STEAM_API_KEY, steamId: v.STEAM_ID }),
  igdb: (v) => validate.validateIgdb({ clientId: v.TWITCH_CLIENT_ID, clientSecret: v.TWITCH_CLIENT_SECRET }),
  xbox: (v) => validate.validateOpenXbl({ apiKey: v.OPENXBL_API_KEY }),
  epic: () => validate.validateEpic({}),
};

function groupHasValues(group, values) {
  return (group.fields || []).some((f) => values[f.key]);
}

// ── recorrido de un grupo normal (Steam, IGDB, Xbox, puerto) ─────────────
// Devuelve el resultado de la última validación, o null si el grupo no valida.
async function runFieldGroup(prompter, group, values, autoOpen) {
  while (true) {
    for (const field of group.fields) {
      const current = values[field.key] || field.default || '';
      console.log(`\n${bold(field.label)}`);
      showLink(field.url, autoOpen);
      if (field.guide) guide(field.guide);

      const shown = field.secret ? maskValue(current) : current || dim('(vacío)');
      const hints = [];
      if (current) hints.push(`ahora: ${shown} — Enter para dejarlo`);
      if (field.secret) hints.push('no se verá al teclear');
      const hintStr = hints.length ? dim(` (${hints.join('; ')})`) : '';
      let answer = cleanAnswer(
        await prompter.question(`  ${field.prompt || 'Valor'}${hintStr}: `, { mask: field.secret }),
        field
      );
      if (!answer) answer = current;

      if (field.key === 'STEAM_ID' && answer) {
        process.stdout.write(dim('  resolviendo tu cuenta… '));
        const resolved = await validate.resolveSteamId(answer, { apiKey: values.STEAM_API_KEY });
        if (resolved.steamId) {
          console.log(`${OK} ${dim(`SteamID64: ${resolved.steamId}`)}`);
          answer = resolved.steamId;
        } else {
          console.log(`${yellow('⚠')} ${yellow(resolved.error)}`);
        }
      }

      values[field.key] = answer;
    }

    const validator = GROUP_VALIDATORS[group.id];
    if (!validator || !groupHasValues(group, values)) return null;

    process.stdout.write(dim('\n  comprobando con el servidor… '));
    const result = await validator(values);
    if (result.ok) {
      console.log(`${OK} ${green(result.detail || 'correcto')}`);
      return result;
    }
    console.log(`${BAD} ${red(result.error)}`);

    const choice = (
      await prompter.question('  ¿Qué hago?  [r] reintentar · [g] guardar igual · [o] descartar este grupo: ')
    )
      .trim()
      .toLowerCase();
    if (choice === 'g') return result;
    if (choice === 'o') {
      for (const f of group.fields) values[f.key] = '';
      return null;
    }
    // cualquier otra cosa: reintentar
  }
}

// ── Epic: alta por código de autorización ───────────────────────────────
async function runEpicGroup(prompter, group, autoOpen) {
  console.log('');
  showLink(group.url, autoOpen);
  guide(group.guide);
  while (true) {
    const raw = await prompter.question('\n  Pega el authorizationCode (o el texto entero; Enter para omitir): ');
    if (!raw.trim()) return null;

    // Si pegó el JSON entero, sacar el código; si pegó solo el código, dejarlo.
    const match = raw.match(/authorizationCode["']?\s*[:=]\s*["']?([A-Za-z0-9]{16,})/i);
    const code = (match ? match[1] : raw).replace(/[^A-Za-z0-9]/g, '');

    process.stdout.write(dim('  canjeando el código… '));
    const result = await validate.activateEpic(code);
    if (result.ok) {
      console.log(`${OK} ${green(result.detail)}`);
      return result;
    }
    console.log(`${BAD} ${red(result.error)}`);
    if (!(await askYesNo(prompter, '  ¿Probar con otro código?', true))) return result;
  }
}

// Lanza un comando de npm/node del proyecto mostrando su salida en directo.
function runProjectNode(args, label) {
  console.log(bold(`\n▶ ${label}`));
  const r = spawnSync(process.execPath, args, { cwd: PROJECT_ROOT, stdio: 'inherit' });
  return r.status === 0;
}

// ── modo interactivo ───────────────────────────────────────────────────
async function runWizard() {
  const values = readEnv();
  const prompter = createPrompter();

  console.log(bold('\n  SteamDB · asistente de instalación'));
  console.log(
    dim(
      '  Te guío para conseguir cada clave: abro la web que toca, te doy los pasos\n' +
        '  y compruebo el valor al momento. Lo que no uses, lo saltas.\n' +
        '  Todo se guarda en .env (con copia de seguridad en .env.bak). Ctrl+C para salir.'
    )
  );

  const autoOpen =
    process.stdout.isTTY &&
    (await askYesNo(prompter, '\n¿Abro yo cada página web en el navegador cuando toque?', true));

  const results = {};

  for (const group of GROUPS) {
    heading(group.title);
    if (group.need) console.log(dim(`  Necesitas: ${group.need}`));
    if (group.intro) console.log(group.intro);

    if (!group.required) {
      const had = group.special === 'epic' ? false : groupHasValues(group, values);
      if (!(await askYesNo(prompter, '\n¿Configurar ahora?', had))) {
        console.log(dim('  saltado.'));
        continue;
      }
    }

    results[group.id] =
      group.special === 'epic'
        ? await runEpicGroup(prompter, group, autoOpen)
        : await runFieldGroup(prompter, group, values, autoOpen);
  }

  const { backup } = writeEnv(values);
  console.log(bold('\n═════════════════════════════════════════'));
  console.log(
    `${OK} Guardado en .env${backup ? dim(`  (copia previa en ${path.basename(backup)})`) : ''}`
  );

  // Lo más automático posible: si Steam quedó validado, ofrecer dejar la app
  // lista del todo sin que el usuario tenga que teclear más comandos.
  const steamOk = results.steam?.ok;
  const isRealEnv = !process.env.STEAMDB_ENV_PATH;
  let launched = false;
  if (steamOk && isRealEnv) {
    if (await askYesNo(prompter, '\n¿Preparo la base de datos y hago una primera sincronización ahora?', true)) {
      launched = true;
      const migrated = runProjectNode([path.join('db', 'migrate.js')], 'Creando la base de datos…');
      if (migrated) {
        const synced = runProjectNode(
          ['--env-file-if-exists=.env', path.join('sync', 'run.js')],
          'Primera sincronización con Steam…'
        );
        if (synced) console.log(green('\n✔ Todo listo. Arranca la app con  npm start   (o  npm run electron)'));
        else console.log(yellow('\nLa sincronización falló; puedes reintentarla con  npm run sync'));
      } else {
        console.log(yellow('\nNo se pudo crear la base de datos; revisa el error de arriba.'));
      }
    }
  }

  prompter.close();

  if (!launched) {
    console.log('\nSiguientes pasos:');
    console.log(dim('  npm run migrate   ') + '· crea la base de datos');
    console.log(dim('  npm start         ') + '· arranca la app en el navegador  (o  npm run electron)');
    console.log(dim('  npm run sync      ') + '· primera sincronización');
  }
  console.log(dim('\nRevisa el estado cuando quieras con  npm run setup:check'));
}

// ── modo doctor (--check): no pregunta nada, solo informa ───────────────
async function runDoctor() {
  const fromFile = readEnv();
  const val = (k) => process.env[k] || fromFile[k] || '';

  console.log(bold('\nSteamDB · revisión de configuración\n'));
  const label = (t) => `${t} ${dim('.'.repeat(Math.max(2, 22 - t.length)))} `;
  let anyFailure = false;

  const checks = [
    ['Steam', 'steam', () => val('STEAM_API_KEY') && val('STEAM_ID')],
    ['IGDB', 'igdb', () => val('TWITCH_CLIENT_ID') && val('TWITCH_CLIENT_SECRET')],
    ['Xbox / Game Pass', 'xbox', () => val('OPENXBL_API_KEY')],
    ['Epic Games', 'epic', () => true], // validateEpic ya detecta si no hay sesión
  ];

  for (const [title, id, configured] of checks) {
    if (id === 'epic') {
      const r = await validate.validateEpic({});
      if (r.ok) console.log(label(title) + `${OK} ${dim(r.detail)}`);
      else console.log(label(title) + dim('— sin configurar') + dim(` (${r.error})`));
      continue;
    }
    if (!configured()) {
      console.log(label(title) + dim('— sin configurar'));
      continue;
    }
    process.stdout.write(label(title));
    const r = await GROUP_VALIDATORS[id]({
      STEAM_API_KEY: val('STEAM_API_KEY'),
      STEAM_ID: val('STEAM_ID'),
      TWITCH_CLIENT_ID: val('TWITCH_CLIENT_ID'),
      TWITCH_CLIENT_SECRET: val('TWITCH_CLIENT_SECRET'),
      OPENXBL_API_KEY: val('OPENXBL_API_KEY'),
    });
    if (r.ok) {
      console.log(`${OK} ${dim(r.detail || 'correcto')}`);
    } else {
      console.log(`${BAD} ${red(r.error)}`);
      anyFailure = true;
    }
  }

  const port = val('PORT') || '3000';
  console.log(label('Servidor local') + dim(`puerto ${port}`));

  if (!val('STEAM_API_KEY') || !val('STEAM_ID')) {
    console.log(yellow('\nFalta la configuración de Steam (obligatoria). Corre  npm run setup'));
    anyFailure = true;
  }
  process.exitCode = anyFailure ? 1 : 0;
}

async function main() {
  if (process.argv.includes('--check')) return runDoctor();
  return runWizard();
}

if (require.main === module) {
  main().catch((err) => {
    console.error(red(`\nel asistente falló: ${err.message}`));
    process.exitCode = 1;
  });
}

module.exports = { runWizard, runDoctor };
