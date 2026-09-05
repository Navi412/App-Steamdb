// Monorepo: la app reutiliza directamente /core, /db, /sync, /xbox, /epic,
// /igdb y /setup del proyecto de escritorio (import relativo, sin duplicar
// código) — Metro necesita ver fuera de mobile/ para eso. Se excluye el
// node_modules de la raíz (Electron, electron-builder...) del rastreo: el
// código compartido no tiene dependencias externas propias, así que no hace
// falta, y sin excluirlo Metro tarda mucho más en arrancar.
//
// Ese código compartido sí depende de algo indirectamente: Babel reescribe
// `async function` con helpers de @babel/runtime, y esa dependencia la
// arrastra el propio output, no el código fuente. Como esos ficheros viven
// fuera de mobile/ (p.ej. /sync/run.js), su búsqueda de node_modules
// normal sube hasta la raíz — justo la que está bloqueada arriba. Por eso
// nodeModulesPaths añade el node_modules de mobile/ como sitio extra donde
// buscar, sin tener que levantar el bloqueo del de la raíz.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');
const exclusionList = require('metro-config/src/defaults/exclusionList');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [path.join(projectRoot, 'node_modules')];

function pathToRegex(p) {
  return new RegExp(`^${p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\\\|/).*$`);
}

config.resolver.blockList = exclusionList([
  pathToRegex(path.join(workspaceRoot, 'node_modules')),
  pathToRegex(path.join(workspaceRoot, 'dist')),
  pathToRegex(path.join(workspaceRoot, '.git')),
]);

module.exports = config;
