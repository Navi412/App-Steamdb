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

function steamCoverUrl(game, variant = 'capsule_184x69.jpg') {
  return game.steamAppId
    ? `https://cdn.cloudflare.steamstatic.com/steam/apps/${game.steamAppId}/${variant}`
    : null;
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

// Carátula: para Steam la cápsula bonita; si no (Xbox, o un Steam cuya
// cápsula no existe) el icon_url que haya guardado la sync. Los juegos
// manuales no tienen ninguno: hueco de reserva.
function coverUrl(game, { lg = false } = {}) {
  return steamCoverUrl(game, lg ? 'header.jpg' : 'capsule_184x69.jpg') || normalizeIconUrl(game.iconUrl);
}

function coverHtml(game, { size = '' } = {}) {
  const url = coverUrl(game, { lg: size === 'lg' });
  const sizeClass = size ? ` cover-${size}` : '';
  if (!url) return `<span class="cover${sizeClass} cover-fallback"></span>`;
  return `<span class="cover${sizeClass}"><img src="${url}" alt="" loading="lazy" onerror="this.parentElement.classList.add('cover-fallback')"></span>`;
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
