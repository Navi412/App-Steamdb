function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));
}

function formatHours(minutes) {
  return (minutes / 60).toFixed(1) + ' h';
}

function formatDate(iso) {
  if (!iso) return null;
  return new Date(iso).toLocaleString('es-ES', { dateStyle: 'medium', timeStyle: 'short' });
}

// Las imágenes de la Store de Microsoft (juegos de Xbox) llegan como el
// póster a tamaño completo por http. Se fuerza https y se pide una versión
// reducida — sin esto son ~800 KB cada una y muchas ni cargan.
function normalizeIconUrl(url) {
  if (!url) return null;
  if (url.includes('store-images.s-microsoft.com')) {
    return `${url.replace(/^http:/, 'https:')}?q=90&w=320`;
  }
  return url;
}

// Carátula vertical (formato caja de juego), para que Steam y Xbox se vean
// igual y sin recortes raros:
//  - Steam: library_600x900 (arte de biblioteca, 2:3). Si no existe, se
//    reintenta con header.jpg antes de rendirse.
//  - resto (Xbox): el icon_url que guardó la sync.
//  - manuales: sin imagen, hueco de reserva.
// Encuadre elegido a mano para este juego (object-position en %). 50/50 es el
// valor por defecto y no necesita estilo: la hoja de estilos ya centra.
function coverPosStyle(game) {
  const x = Number.isFinite(game.coverPosX) ? game.coverPosX : 50;
  const y = Number.isFinite(game.coverPosY) ? game.coverPosY : 50;
  if (x === 50 && y === 50) return '';
  return ` style="object-position:${x}% ${y}%"`;
}

// Steam sirve library_600x900.jpg y header.jpg con 200 OK aunque el
// publisher no haya subido carátula (un rectángulo gris liso, visto con
// Battlefield 6 recién lanzado) — un simple onerror no lo detecta porque la
// petición "tiene éxito". Se comprueba dibujando la imagen ya cargada en un
// canvas minúsculo: si todos los píxeles son casi el mismo color, se trata
// como si hubiera fallado y se pasa al siguiente candidato.
function isBlankCover(img) {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 8;
    canvas.height = 8;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, 8, 8);
    const { data } = ctx.getImageData(0, 0, 8, 8);
    let min = 255;
    let max = 0;
    for (let i = 0; i < data.length; i += 4) {
      const v = (data[i] + data[i + 1] + data[i + 2]) / 3;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    return max - min < 6;
  } catch {
    // Lienzo "contaminado" (el CDN no mandó CORS) u otro fallo: no se puede
    // comprobar, así que se asume que la imagen cargada es válida.
    return false;
  }
}

// Prueba con el siguiente candidato de carátula (data-candidates, en JSON);
// si ya no quedan, se rinde y muestra el hueco de reserva.
function advanceCover(img) {
  const candidates = JSON.parse(img.dataset.candidates || '[]');
  const idx = Number(img.dataset.idx || 0) + 1;
  if (idx >= candidates.length) {
    img.parentElement.classList.add('cover-fallback');
    return;
  }
  img.dataset.idx = idx;
  img.src = candidates[idx];
}

function checkCoverLoaded(img) {
  if (isBlankCover(img)) advanceCover(img);
}

function coverHtml(game, { size = '' } = {}) {
  const sizeClass = size ? ` cover-${size}` : '';
  const pos = coverPosStyle(game);

  // Carátula subida por el usuario: manda sobre el arte de Steam/Xbox.
  if (game.coverUrl) {
    return `<span class="cover${sizeClass}"><img src="${escapeHtml(game.coverUrl)}" alt="" loading="lazy" draggable="false"${pos} onerror="this.parentElement.classList.add('cover-fallback')"></span>`;
  }

  // Steam: library_600x900 (arte de biblioteca, 2:3), luego header.jpg, y
  // como último recurso la carátula de IGDB si la tenemos (ver setIgdbTimes
  // en db/games.js). Resto de orígenes: directamente el icon_url que guardó
  // la sync (Xbox, GOG, Epic...) o IGDB (manuales).
  const candidates = [];
  let checkBlank = false;
  if (game.steamAppId) {
    const base = `https://cdn.cloudflare.steamstatic.com/steam/apps/${game.steamAppId}`;
    candidates.push(`${base}/library_600x900.jpg`, `${base}/header.jpg`);
    checkBlank = true;
  }
  const iconUrl = normalizeIconUrl(game.iconUrl);
  if (iconUrl) candidates.push(iconUrl);

  if (candidates.length === 0) return `<span class="cover${sizeClass} cover-fallback"></span>`;

  const dataCandidates = escapeHtml(JSON.stringify(candidates));
  const extra = checkBlank ? ` crossorigin="anonymous" onload="checkCoverLoaded(this)"` : '';
  return `<span class="cover${sizeClass}"><img src="${candidates[0]}" data-candidates="${dataCandidates}" data-idx="0" alt="" loading="lazy" draggable="false"${pos}${extra} onerror="advanceCover(this)"></span>`;
}

// El marcador de horas totales vive en ambas páginas (lista y detalle). La
// lista ya tiene los juegos cargados y llama a renderTotalHoursFromGames
// directamente; el detalle no, así que pide su propia copia con fetch.
function renderTotalHoursFromGames(games) {
  const el = document.getElementById('total-hours-badge');
  if (!el) return;
  const totalMinutes = games.reduce((sum, g) => sum + g.totalMinutes, 0);
  el.textContent = `⏱ ${formatHours(totalMinutes)} en total`;
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('no se pudo leer el archivo'));
    reader.readAsDataURL(file);
  });
}

// Sube (o reemplaza) la carátula de un juego. `payload` es { dataUrl } para
// un archivo ya leído, o { url } para un enlace que descargará el servidor.
function saveCover(gameId, payload) {
  return submitJson(`/api/games/${gameId}/cover`, 'PUT', payload);
}

function removeCover(gameId) {
  return submitJson(`/api/games/${gameId}/cover`, 'DELETE', {});
}

async function submitJson(url, method, body) {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'error desconocido' }));
    throw new Error(err.error);
  }
  return res.json();
}

// --- temas de la app: paleta + fondo personal ---
// Los valores de "preview" son solo para pintar la muestra del selector;
// los colores reales viven en las variables CSS de cada tema (styles.css).
const THEMES = [
  { id: 'dark', name: 'Glass oscuro', preview: 'linear-gradient(135deg, #0a0e1a, #7cc4ff, #a996ff)' },
  { id: 'midnight', name: 'Medianoche', preview: 'linear-gradient(135deg, #05070d, #5ad1ff, #4f8dff)' },
  { id: 'aurora', name: 'Aurora', preview: 'linear-gradient(135deg, #06120f, #4be3b0, #38bdf8)' },
  { id: 'amber', name: 'Ámbar', preview: 'linear-gradient(135deg, #170d08, #ffb454, #ff7a59)' },
  { id: 'light', name: 'Claro', preview: 'linear-gradient(135deg, #f3f5fb, #2f7dd1, #7c5cff)' },
];
const THEME_KEY = 'sdb-theme';
const BG_IMAGE_KEY = 'sdb-bg-image';

function getStoredTheme() {
  try {
    return localStorage.getItem(THEME_KEY) || 'dark';
  } catch {
    return 'dark';
  }
}

function setTheme(id) {
  document.documentElement.dataset.theme = id;
  try {
    localStorage.setItem(THEME_KEY, id);
  } catch {}
}

function getStoredBgImage() {
  try {
    return localStorage.getItem(BG_IMAGE_KEY) || null;
  } catch {
    return null;
  }
}

function setBgImage(dataUrl) {
  document.documentElement.style.setProperty('--bg-image', `url(${JSON.stringify(dataUrl)})`);
  document.documentElement.classList.add('has-bg-image');
  try {
    localStorage.setItem(BG_IMAGE_KEY, dataUrl);
  } catch (err) {
    throw new Error('la imagen es demasiado grande para guardarla');
  }
}

function clearBgImage() {
  document.documentElement.style.removeProperty('--bg-image');
  document.documentElement.classList.remove('has-bg-image');
  try {
    localStorage.removeItem(BG_IMAGE_KEY);
  } catch {}
}

// Redimensiona y comprime la imagen en el propio navegador (canvas, sin
// dependencias) antes de guardarla: una foto de cámara sin tocar no cabe
// cómodamente en localStorage y tarda en pintarse de fondo.
function readImageAsBackgroundDataUrl(file, { maxSize = 1920, quality = 0.82 } = {}) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/jpeg', quality));
      URL.revokeObjectURL(img.src);
    };
    img.onerror = () => reject(new Error('no se pudo leer la imagen'));
    img.src = URL.createObjectURL(file);
  });
}

async function renderTotalHoursBadge() {
  const el = document.getElementById('total-hours-badge');
  if (!el) return;
  try {
    const res = await fetch('/api/games');
    renderTotalHoursFromGames(await res.json());
  } catch {
    el.textContent = '';
  }
}
