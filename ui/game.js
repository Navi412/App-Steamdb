const PRECISION_LABELS = { exact: 'hora exacta', approximate: 'aproximada', derived: 'derivada de Steam' };

function gameIdFromUrl() {
  return new URLSearchParams(window.location.search).get('id');
}

function renderHeader(game) {
  document.title = `${game.title} — SteamDB`;
  document.getElementById('game-header').innerHTML = `
    ${coverHtml(game, { size: 'lg' })}
    <h1>${escapeHtml(game.title)}</h1>
    <span class="platform">${escapeHtml(game.platform)}</span>
    ${game.missingSince ? '<span class="badge">ya no está en Steam</span>' : ''}
  `;

  document.getElementById('game-stats').innerHTML = `
    <div><strong>${formatHours(game.totalMinutes)}</strong>jugadas en total</div>
    ${game.achievementsTotal > 0
      ? `<div><strong>${game.achievementsUnlocked}/${game.achievementsTotal}</strong>logros 🏆</div>`
      : ''}
  `;
}

function renderIgdb(game) {
  const stats = document.getElementById('igdb-stats');
  stats.innerHTML = `
    ${game.igdbMainMinutes ? `<div><strong>${formatHours(game.igdbMainMinutes)}</strong>historia principal</div>` : ''}
    ${game.igdbCompletionistMinutes ? `<div><strong>${formatHours(game.igdbCompletionistMinutes)}</strong>completista</div>` : ''}
  `;

  const form = document.getElementById('igdb-form');
  form.mainHours.value = game.igdbMainMinutes ? (game.igdbMainMinutes / 60).toFixed(2) : '';
  form.completionistHours.value = game.igdbCompletionistMinutes ? (game.igdbCompletionistMinutes / 60).toFixed(2) : '';
}

function renderCoverEdit(game) {
  document.getElementById('cover-remove').hidden = !game.coverUrl;
}

async function onCoverFileChange(event) {
  const file = event.target.files[0];
  if (!file) return;
  const msg = document.getElementById('cover-msg');
  msg.textContent = 'Subiendo…';
  try {
    await saveCover(gameIdFromUrl(), { dataUrl: await readFileAsDataUrl(file) });
    msg.textContent = '';
    await loadGame();
  } catch (err) {
    msg.textContent = err.message;
  } finally {
    event.target.value = '';
  }
}

async function onCoverRemove() {
  const msg = document.getElementById('cover-msg');
  try {
    await removeCover(gameIdFromUrl());
    msg.textContent = '';
    await loadGame();
  } catch (err) {
    msg.textContent = err.message;
  }
}

function sessionSortKey(session) {
  return session.endedAt || session.startedAt || session.createdAt;
}

function sessionLabel(session) {
  if (session.startedAt && session.endedAt) {
    return `${formatDate(session.startedAt)} → ${formatDate(session.endedAt)}`;
  }
  if (!session.startedAt && session.endedAt) {
    return `hasta ${formatDate(session.endedAt)} (antes de empezar a sincronizar)`;
  }
  return `registrada el ${formatDate(session.createdAt)}`;
}

function renderSessions(sessions) {
  const list = document.getElementById('sessions-list');

  if (sessions.length === 0) {
    list.innerHTML = '<li class="empty">Todavía no hay sesiones registradas.</li>';
    return;
  }

  const sorted = [...sessions].sort((a, b) => sessionSortKey(b).localeCompare(sessionSortKey(a)));

  list.innerHTML = sorted
    .map(
      (session) => `
        <li class="session">
          <span class="minutes">${formatHours(session.minutes)}</span>
          <span class="when">${sessionLabel(session)}</span>
          <span class="precision">${PRECISION_LABELS[session.precision] || session.precision}</span>
          ${session.note ? `<span class="note">${escapeHtml(session.note)}</span>` : ''}
        </li>
      `
    )
    .join('');
}

function renderAchievements(achievements) {
  const list = document.getElementById('achievements-list');

  if (achievements.length === 0) {
    list.innerHTML = '<li class="empty">Este juego no tiene logros en Steam (o todavía no se han sincronizado).</li>';
    return;
  }

  list.innerHTML = achievements
    .map(
      (achievement) => `
        <li class="achievement ${achievement.achieved ? '' : 'locked'}">
          <span class="icon">${achievement.achieved ? '🏆' : '🔒'}</span>
          <span>
            <div class="name">${escapeHtml(achievement.name || achievement.apiName)}</div>
            ${achievement.description ? `<div class="description">${escapeHtml(achievement.description)}</div>` : ''}
          </span>
          ${achievement.achieved ? `<span class="unlocked-at">${formatDate(achievement.unlockedAt)}</span>` : ''}
        </li>
      `
    )
    .join('');
}

async function loadGame() {
  const id = gameIdFromUrl();
  if (!id) {
    document.getElementById('game-header').innerHTML = '<p class="empty">Falta el id del juego en la URL.</p>';
    return;
  }

  const [gameRes, sessions, achievements] = await Promise.all([
    fetch(`/api/games/${id}`),
    fetch(`/api/games/${id}/sessions`).then((r) => r.json()),
    fetch(`/api/games/${id}/achievements`).then((r) => r.json()),
  ]);

  if (!gameRes.ok) {
    document.getElementById('game-header').innerHTML = '<p class="empty">Juego no encontrado.</p>';
    return;
  }

  const game = await gameRes.json();
  renderHeader(game);
  renderCoverEdit(game);
  renderSessions(sessions);
  renderAchievements(achievements);
  renderIgdb(game);
}

const igdbSearchButton = document.getElementById('igdb-search-button');
const IGDB_SEARCH_LABEL = igdbSearchButton.textContent;

igdbSearchButton.addEventListener('click', async () => {
  const id = gameIdFromUrl();
  igdbSearchButton.disabled = true;
  igdbSearchButton.textContent = 'Buscando...';
  try {
    const game = await submitJson(`/api/games/${id}/igdb/search`, 'POST', {});
    renderIgdb(game);
  } catch (err) {
    alert(err.message);
  } finally {
    igdbSearchButton.disabled = false;
    igdbSearchButton.textContent = IGDB_SEARCH_LABEL;
  }
});

document.getElementById('igdb-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const id = gameIdFromUrl();
  const form = event.target;
  try {
    const game = await submitJson(`/api/games/${id}/igdb`, 'PATCH', {
      mainMinutes: form.mainHours.value ? Math.round(Number(form.mainHours.value) * 60) : null,
      completionistMinutes: form.completionistHours.value ? Math.round(Number(form.completionistHours.value) * 60) : null,
    });
    renderIgdb(game);
  } catch (err) {
    alert(err.message);
  }
});

document.getElementById('cover-file').addEventListener('change', onCoverFileChange);
document.getElementById('cover-remove').addEventListener('click', onCoverRemove);

loadGame();
renderTotalHoursBadge();
