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

  renderHeader(await gameRes.json());
  renderSessions(sessions);
  renderAchievements(achievements);
}

loadGame();
