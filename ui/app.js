async function checkHealth() {
  const el = document.getElementById('status');
  try {
    const res = await fetch('/health');
    const data = await res.json();
    el.textContent = `${data.status} (db: ${data.db})`;
    el.className = data.status === 'ok' && data.db === 'ok' ? 'ok' : 'error';
  } catch {
    el.textContent = 'sin respuesta';
    el.className = 'error';
  }
}

let allGames = [];

async function fetchGames() {
  const res = await fetch('/api/games');
  return res.json();
}

const SORTERS = {
  title: (a, b) => a.title.localeCompare(b.title, 'es', { sensitivity: 'base' }),
  most: (a, b) => b.totalMinutes - a.totalMinutes || a.title.localeCompare(b.title, 'es'),
  least: (a, b) => a.totalMinutes - b.totalMinutes || a.title.localeCompare(b.title, 'es'),
};

// Rellena el desplegable de plataformas con las presentes en la biblioteca,
// conservando lo que hubiera elegido el usuario.
function refreshPlatformOptions() {
  const select = document.getElementById('platform-filter');
  const current = select.value;
  const platforms = [...new Set(allGames.flatMap((g) => g.platforms || [g.platform]))].sort((a, b) =>
    a.localeCompare(b, 'es')
  );
  select.innerHTML =
    '<option value="">Todas las plataformas</option>' +
    platforms.map((p) => `<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`).join('');
  select.value = platforms.includes(current) ? current : '';
}

function applyView() {
  const term = document.getElementById('search-input').value.trim().toLowerCase();
  const platform = document.getElementById('platform-filter').value;
  const sort = document.getElementById('sort-order').value;

  let games = allGames;
  if (term) games = games.filter((g) => g.title.toLowerCase().includes(term));
  if (platform) games = games.filter((g) => (g.platforms || [g.platform]).includes(platform));

  renderGames([...games].sort(SORTERS[sort] || SORTERS.title));
}

function renderGames(games) {
  const list = document.getElementById('games-list');
  list.innerHTML = '';

  if (games.length === 0) {
    list.innerHTML = '<li class="empty">Ningún juego coincide con la búsqueda.</li>';
    return;
  }

  for (const game of games) {
    const li = document.createElement('li');
    li.className = 'game' + (game.archived ? ' archived' : '');

    // Un juego en varias plataformas es varias filas en la BD (una por
    // tienda). platforms[i] va alineado con platformIds[i]; la primera es la
    // "principal" y ya es el enlace del título, el resto enlazan a su detalle.
    const platforms = game.platforms || [game.platform];
    const platformIds = game.platformIds || [game.id];
    const platformTags = platforms
      .map((p, i) =>
        i === 0
          ? `<span class="platform">${escapeHtml(p)}</span>`
          : `<a class="platform" href="/game.html?id=${platformIds[i]}">${escapeHtml(p)}</a>`
      )
      .join('');

    li.innerHTML = `
      ${coverHtml(game)}
      <span class="title"><a href="/game.html?id=${game.id}">${escapeHtml(game.title)}</a></span>
      <span class="platforms">${platformTags}</span>
      <span class="total">${formatHours(game.totalMinutes)}</span>
      ${game.achievementsTotal > 0 ? `<span class="achievements">🏆 ${game.achievementsUnlocked}/${game.achievementsTotal}</span>` : ''}
      ${game.igdbMainMinutes ? `<span class="igdb">⏱ ${formatHours(game.igdbMainMinutes)}</span>` : ''}
      ${game.missingSince ? '<span class="badge">ya no está en Steam</span>' : ''}
      <form class="log-session" data-game-id="${game.id}">
        <input type="number" name="hours" min="0.25" step="0.25" placeholder="horas" required>
        <button type="submit">Registrar</button>
      </form>
    `;
    list.appendChild(li);
  }
}

async function refreshGames() {
  allGames = await fetchGames();
  refreshPlatformOptions();
  applyView();
  renderTotalHoursFromGames(allGames);
}

document.getElementById('add-game-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.target;
  try {
    await submitJson('/api/games', 'POST', {
      title: form.title.value,
      platform: form.platform.value,
    });
    form.reset();
    await refreshGames();
  } catch (err) {
    alert(err.message);
  }
});

document.getElementById('games-list').addEventListener('submit', async (event) => {
  if (!event.target.classList.contains('log-session')) return;
  event.preventDefault();
  const form = event.target;
  try {
    const minutes = Math.round(Number(form.hours.value) * 60);
    await submitJson(`/api/games/${form.dataset.gameId}/sessions`, 'POST', { minutes });
    form.reset();
    await refreshGames();
  } catch (err) {
    alert(err.message);
  }
});

const syncButton = document.getElementById('sync-button');
const SYNC_LABEL = syncButton.textContent;

syncButton.addEventListener('click', async () => {
  syncButton.disabled = true;
  syncButton.textContent = 'Sincronizando...';
  try {
    const result = await submitJson('/api/sync', 'POST', {});
    await refreshGames();
    const failed = Object.entries(result.launchers || {})
      .filter(([, r]) => !r.ok)
      .map(([name]) => name);
    syncButton.textContent = failed.length
      ? `Hecho: ${result.gamesSynced} (sin ${failed.join(', ')})`
      : `Hecho: ${result.gamesSynced} juegos`;
  } catch (err) {
    alert(err.message);
    syncButton.textContent = SYNC_LABEL;
  } finally {
    setTimeout(() => {
      syncButton.textContent = SYNC_LABEL;
      syncButton.disabled = false;
    }, 3000);
  }
});

document.getElementById('search-input').addEventListener('input', applyView);
document.getElementById('platform-filter').addEventListener('change', applyView);
document.getElementById('sort-order').addEventListener('change', applyView);

checkHealth();
refreshGames();
