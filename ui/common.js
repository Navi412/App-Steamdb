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

// Los juegos manuales no tienen steamAppId, así que no hay carátula posible
// para ellos: la lista muestra el hueco de reserva en su lugar.
function steamCoverUrl(game, variant = 'capsule_184x69.jpg') {
  return game.steamAppId
    ? `https://cdn.cloudflare.steamstatic.com/steam/apps/${game.steamAppId}/${variant}`
    : null;
}

function coverHtml(game, { size = '' } = {}) {
  const url = steamCoverUrl(game, size === 'lg' ? 'header.jpg' : 'capsule_184x69.jpg');
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
