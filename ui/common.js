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
function coverHtml(game, { size = '' } = {}) {
  const sizeClass = size ? ` cover-${size}` : '';

  // Carátula subida por el usuario: manda sobre el arte de Steam/Xbox.
  if (game.coverUrl) {
    return `<span class="cover${sizeClass}"><img src="${escapeHtml(game.coverUrl)}" alt="" loading="lazy" draggable="false" onerror="this.parentElement.classList.add('cover-fallback')"></span>`;
  }

  let primary = null;
  let fallback = null;
  if (game.steamAppId) {
    const base = `https://cdn.cloudflare.steamstatic.com/steam/apps/${game.steamAppId}`;
    primary = `${base}/library_600x900.jpg`;
    fallback = `${base}/header.jpg`;
  } else {
    primary = normalizeIconUrl(game.iconUrl);
  }

  if (!primary) return `<span class="cover${sizeClass} cover-fallback"></span>`;

  const onError = fallback
    ? `if(this.dataset.f){this.parentElement.classList.add('cover-fallback')}else{this.dataset.f=1;this.src='${fallback}'}`
    : `this.parentElement.classList.add('cover-fallback')`;
  return `<span class="cover${sizeClass}"><img src="${primary}" alt="" loading="lazy" draggable="false" onerror="${onError}"></span>`;
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
