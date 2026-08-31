// Cliente de OpenXBL (xbl.io), un puente de terceros con Xbox Live. Igual
// que /sync con Steam: sabe hablar HTTP y traducir la respuesta a datos
// simples, sin saber nada de SQLite ni de qué juego de nuestra base se
// trata.
//
// Se usa OpenXBL en vez de hablar directo con Xbox Live porque este último
// exige una cadena de OAuth de Microsoft (token MS -> token XBL -> token
// XSTS) que para una app personal es mucho lío. OpenXBL lo resuelve con una
// sola API key que se saca del perfil en xbl.io.
//
// El minutaje jugado vive en el stat "MinutesPlayed" de cada título, que
// no viene en el historial: hay que pedirlo título por título.

const BASE_URL = 'https://xbl.io/api/v2';

async function xblRequest(path, { apiKey, fetchImpl = fetch }) {
  if (!apiKey) throw new Error('OPENXBL_API_KEY no configurada');

  // Accept-Language explícito: el fetch de Node manda "*" por defecto y Xbox
  // lo rechaza con un 400 (que además OpenXBL devuelve con HTTP 200 y el
  // código real dentro del cuerpo, así que hay que mirar body.code).
  const res = await fetchImpl(`${BASE_URL}${path}`, {
    headers: { 'X-Authorization': apiKey, Accept: 'application/json', 'Accept-Language': 'en-US' },
  });
  if (!res.ok) throw new Error(`OpenXBL respondió ${res.status} en ${path}`);

  const body = await res.json();
  if (typeof body?.code === 'number' && body.code >= 400) {
    throw new Error(`OpenXBL respondió ${body.code} en ${path}: ${JSON.stringify(body.content)}`);
  }
  return body;
}

// Historial de títulos jugados. Se filtran los que no son juegos (launchers,
// apps) y se aplana lo que nos interesa.
async function fetchPlayedTitles({ apiKey, fetchImpl = fetch } = {}) {
  const body = await xblRequest('/player/titleHistory', { apiKey, fetchImpl });
  const titles = body?.content?.titles || [];

  return titles
    .filter((t) => t.type === 'Game')
    .map((t) => ({
      titleId: String(t.titleId),
      title: t.name,
      iconUrl: t.displayImage || null,
      isGamePass: Boolean(t.gamePass?.isGamePass),
      lastPlayed: t.titleHistory?.lastTimePlayed || null,
    }));
}

// Minutos jugados acumulados de un título, o null si Xbox no tiene el dato
// (juego viejo, jugado solo en móvil/cloud sin tracking, etc.).
async function fetchMinutesPlayed(titleId, { apiKey, fetchImpl = fetch } = {}) {
  if (!titleId) throw new Error('titleId es obligatorio');

  const body = await xblRequest(`/achievements/stats/${Number(titleId)}`, { apiKey, fetchImpl });

  const stats = body?.content?.statlistscollection?.flatMap((c) => c.stats || []) || [];
  const minutes = stats.find((s) => s.name === 'MinutesPlayed');
  if (!minutes || minutes.value == null || minutes.value === '') return null;

  const n = Number(minutes.value);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
}

module.exports = { fetchPlayedTitles, fetchMinutesPlayed, BASE_URL };
