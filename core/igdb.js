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

module.exports = { normalizeTitle, pickBestMatch };
