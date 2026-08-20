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
