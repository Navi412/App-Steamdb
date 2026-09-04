function validateManualGame({ title, platform } = {}) {
  const cleanTitle = typeof title === 'string' ? title.trim() : '';
  const cleanPlatform = typeof platform === 'string' ? platform.trim() : '';

  if (!cleanTitle) throw new Error('title es obligatorio');
  if (!cleanPlatform) throw new Error('platform es obligatorio');

  return { title: cleanTitle, platform: cleanPlatform };
}

function validateGameUpdate(changes = {}) {
  const result = {};

  if (changes.title !== undefined) {
    const cleanTitle = typeof changes.title === 'string' ? changes.title.trim() : '';
    if (!cleanTitle) throw new Error('title no puede quedar vacío');
    result.title = cleanTitle;
  }

  if (changes.platform !== undefined) {
    const cleanPlatform = typeof changes.platform === 'string' ? changes.platform.trim() : '';
    if (!cleanPlatform) throw new Error('platform no puede quedar vacío');
    result.platform = cleanPlatform;
  }

  if (changes.archived !== undefined) {
    result.archived = Boolean(changes.archived);
  }

  return result;
}

function validatePositiveMinutesOrNull(value, field) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw new Error(`${field} debe ser un número ≥ 0`);
  return Math.round(n);
}

// A diferencia de validateGameUpdate, esto siempre devuelve ambos campos
// (nunca "sin cambios"): el formulario de IGDB en la UI envía los dos a la
// vez, y dejar uno en blanco significa "borrar ese tiempo", no "no tocarlo".
function validateIgdbUpdate({ mainMinutes, completionistMinutes } = {}) {
  return {
    mainMinutes: validatePositiveMinutesOrNull(mainMinutes, 'mainMinutes'),
    completionistMinutes: validatePositiveMinutesOrNull(completionistMinutes, 'completionistMinutes'),
  };
}

// --- carátula propia del usuario ---

const MAX_COVER_BYTES = 5 * 1024 * 1024;
const ALLOWED_COVER_MIMES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif'];

function assertAllowedCoverMime(mime) {
  if (!ALLOWED_COVER_MIMES.includes(String(mime).toLowerCase())) {
    throw new Error('formato no admitido (usa PNG, JPG, WEBP, GIF o AVIF)');
  }
}

// Tamaño de un base64 ya decodificado, sin llegar a decodificarlo.
function base64ByteLength(b64) {
  const clean = b64.replace(/=+$/, '');
  return Math.floor((clean.length * 3) / 4);
}

function parseCoverDataUrl(dataUrl) {
  const match = /^data:([a-z]+\/[a-z0-9.+-]+);base64,(.*)$/is.exec(String(dataUrl).trim());
  if (!match) throw new Error('la imagen no es un data URI base64 válido');

  const mime = match[1].toLowerCase();
  assertAllowedCoverMime(mime);

  const base64 = match[2].replace(/\s+/g, '');
  if (!base64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) {
    throw new Error('la imagen no es un base64 válido');
  }
  if (base64ByteLength(base64) > MAX_COVER_BYTES) {
    throw new Error(`la imagen supera el máximo de ${Math.round(MAX_COVER_BYTES / 1024 / 1024)} MB`);
  }

  return { kind: 'blob', mime, base64 };
}

// Valida la imagen que el usuario quiere como carátula. Dos formas de
// entrada, mutuamente excluyentes:
//   { dataUrl: 'data:image/png;base64,...' }  -> archivo subido desde la UI
//   { url: 'https://...' }                    -> el servidor la descargará
// Devuelve { kind: 'blob', mime, base64 } o { kind: 'url', url }. Pura: la
// descarga y el guardado en base de datos los hace la capa de /api.
function validateCoverInput({ dataUrl, url } = {}) {
  const hasData = dataUrl !== undefined && dataUrl !== null && dataUrl !== '';
  const hasUrl = url !== undefined && url !== null && url !== '';

  if (hasData && hasUrl) throw new Error('manda dataUrl o url, no ambos');
  if (hasData) return parseCoverDataUrl(dataUrl);
  if (hasUrl) {
    const clean = String(url).trim();
    if (!/^https?:\/\//i.test(clean)) {
      throw new Error('la url debe empezar por http:// o https://');
    }
    return { kind: 'url', url: clean };
  }
  throw new Error('falta la imagen (dataUrl o url)');
}

module.exports = {
  validateManualGame,
  validateGameUpdate,
  validateIgdbUpdate,
  validateCoverInput,
  assertAllowedCoverMime,
  MAX_COVER_BYTES,
  ALLOWED_COVER_MIMES,
};
