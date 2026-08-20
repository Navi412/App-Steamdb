function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));
}

function formatHours(minutes) {
  return (minutes / 60).toFixed(1) + ' h';
}

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

async function fetchGames() {
  const res = await fetch('/api/games');
  return res.json();
}

function renderGames(games) {
  const list = document.getElementById('games-list');
  list.innerHTML = '';

  for (const game of games) {
    const li = document.createElement('li');
    li.className = 'game' + (game.archived ? ' archived' : '');
    li.innerHTML = `
      <span class="title">${escapeHtml(game.title)}</span>
      <span class="platform">${escapeHtml(game.platform)}</span>
      <span class="total">${formatHours(game.totalMinutes)}</span>
      ${game.achievementsTotal > 0 ? `<span class="achievements">🏆 ${game.achievementsUnlocked}/${game.achievementsTotal}</span>` : ''}
      ${game.missingSince ? '<span class="badge">ya no está en Steam</span>' : ''}
      <form class="log-session" data-game-id="${game.id}">
        <input type="number" name="minutes" min="1" placeholder="min" required>
        <button type="submit">Registrar</button>
      </form>
    `;
    list.appendChild(li);
  }
}

async function refreshGames() {
  renderGames(await fetchGames());
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
    await submitJson(`/api/games/${form.dataset.gameId}/sessions`, 'POST', {
      minutes: Number(form.minutes.value),
    });
    form.reset();
    await refreshGames();
  } catch (err) {
    alert(err.message);
  }
});

checkHealth();
refreshGames();
