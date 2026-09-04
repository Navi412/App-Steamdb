// Comprobación de requisitos previos. Corre como `preinstall` (antes de
// bajar nada), como `npm run check-node`, y al arrancar el asistente.
// Sin dependencias: solo Node.

const MIN = [22, 5, 0]; // node:sqlite existe desde Node 22.5

function parse(v) {
  return v
    .replace(/^v/, '')
    .split('.')
    .map((n) => parseInt(n, 10) || 0);
}

function lt(a, b) {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] < b[i];
  }
  return false;
}

// Devuelve null si todo va bien, o un mensaje de error si no.
function nodeProblem() {
  if (lt(parse(process.versions.node), MIN)) {
    return (
      `Backlog necesita Node.js ${MIN.join('.')} o superior (tienes ${process.versions.node}).\n` +
      '  Recomendado: la última LTS desde https://nodejs.org\n' +
      '  Con nvm:  nvm install --lts  &&  nvm use --lts'
    );
  }
  // node:sqlite dejó de necesitar --experimental-sqlite en Node 24. En
  // 22.5–23 el módulo existe pero puede pedir el flag; mejor avisar ahora
  // que dejar que la app reviente luego con un error críptico.
  try {
    require('node:sqlite');
  } catch (err) {
    return (
      `Tu Node (${process.versions.node}) trae "node:sqlite" pero no lo deja usar sin flags:\n` +
      `    ${err.message}\n` +
      '  Actualiza a Node 24 o superior (https://nodejs.org) y vuelve a intentarlo.'
    );
  }
  return null;
}

// Aborta el proceso con un mensaje claro si Node no sirve. `silent` calla
// el mensaje de "todo en orden" cuando se llama desde otro script.
function ensureNodeOk({ silent = false } = {}) {
  const problem = nodeProblem();
  if (problem) {
    console.error(`\n  ${problem}\n`);
    process.exit(1);
  }
  if (!silent) {
    console.log(`Node ${process.versions.node} · node:sqlite disponible. Todo en orden.`);
  }
}

module.exports = { nodeProblem, ensureNodeOk };

if (require.main === module) {
  ensureNodeOk({ silent: process.env.npm_lifecycle_event === 'preinstall' });
}
