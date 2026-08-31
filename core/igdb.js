// Elegir, de una lista de resultados de busqueda de IGDB, cual corresponde
// a nuestro juego. Codigo puro: sin red, sin base de datos, solo
// comparacion de texto -- por eso vive en /core y no en /igdb.

function normalizeTitle(title) {
  return title
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// IGDB ordena sus resultados por relevancia interna, no por coincidencia
// exacta de texto: una edicion especial o un DLC puede salir antes que el
// juego base que buscamos. Por eso se prioriza un match exacto de titulo
// normalizado, y solo si no hay ninguno se cae al primer resultado.
function pickBestMatch(candidates, title) {
  if (!candidates || candidates.length === 0) return null;

  const target = normalizeTitle(title);
  const exact = candidates.find((c) => normalizeTitle(c.title) === target);
  return exact || candidates[0];
}

// Como pickBestMatch pero devuelve toda la lista reordenada, no solo el
// primero: los matches exactos de titulo normalizado van delante (en su
// orden original), el resto detras. IGDB tiene entradas duplicadas con el
// mismo titulo y solo algunas traen "Game Time To Beat", asi que el
// proceso en lote (igdb/run.js) necesita poder probar la 2a y la 3a antes
// de rendirse.
function rankedMatches(candidates, title) {
  if (!candidates || candidates.length === 0) return [];

  const target = normalizeTitle(title);
  const exact = candidates.filter((c) => normalizeTitle(c.title) === target);
  const rest = candidates.filter((c) => normalizeTitle(c.title) !== target);
  return [...exact, ...rest];
}

module.exports = { normalizeTitle, pickBestMatch, rankedMatches };
