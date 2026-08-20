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

function applyFilter() {
  const term = document.getElementById('search-input').value.trim().toLowerCase();
  const filtered = term ? allGames.filter((g) => g.title.toLowerCase().includes(term)) : allGames;
  renderGames(filtered);
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
    li.innerHTML = `
      ${coverHtml(game)}
      <span class="title"><a href="/game.html?id=${game.id}">${escapeHtml(game.title)}</a></span>
      <span class="platform">${escapeHtml(game.platform)}</span>
      <span class="total">${formatHours(game.totalMinutes)}</span>
      ${game.achievementsTotal > 0 ? `<span class="achievements">🏆 ${game.achievementsUnlocked}/${game.achievementsTotal}</span>` : ''}
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
  applyFilter();
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
    syncButton.textContent = `Hecho: ${result.gamesSynced} juegos`;
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

document.getElementById('search-input').addEventListener('input', applyFilter);

checkHealth();
refreshGames();
