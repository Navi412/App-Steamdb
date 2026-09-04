const PRECISION_LABELS = { exact: 'hora exacta', approximate: 'aproximada', derived: 'derivada de Steam' };

function gameIdFromUrl() {
  return new URLSearchParams(window.location.search).get('id');
}

function renderHeader(game) {
  document.title = `${game.title} — Backlog`;
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

// Último encuadre confirmado con "Guardar encuadre". Sirve para saber si las
// barras tienen cambios sin guardar y así habilitar/deshabilitar el botón.
let savedCoverPos = { x: 50, y: 50 };

function coverPosEls() {
  return {
    x: document.getElementById('cover-pos-x'),
    y: document.getElementById('cover-pos-y'),
    save: document.getElementById('cover-frame-save'),
  };
}

function refreshCoverSaveState() {
  const { x, y, save } = coverPosEls();
  save.disabled = Number(x.value) === savedCoverPos.x && Number(y.value) === savedCoverPos.y;
}

function renderCoverEdit(game) {
  document.getElementById('cover-remove').hidden = !game.coverUrl;

  // El encuadre solo tiene sentido si hay una imagen que recortar; un juego
  // manual sin carátula muestra el hueco de reserva y no hay nada que mover.
  const frame = document.getElementById('cover-frame');
  const img = document.querySelector('#game-header .cover img');
  frame.hidden = !img;
  if (!img) return;

  const { x, y } = coverPosEls();
  x.value = game.coverPosX ?? 50;
  y.value = game.coverPosY ?? 50;
  savedCoverPos = { x: Number(x.value), y: Number(y.value) };
  refreshCoverSaveState();
}

// Mueve en vivo la carátula grande de la ficha con lo que marcan las barras.
// No guarda nada: eso lo hace el botón "Guardar encuadre".
function applyCoverPos() {
  const img = document.querySelector('#game-header .cover img');
  if (!img) return;
  const { x, y } = coverPosEls();
  img.style.objectPosition = `${x.value}% ${y.value}%`;
}

async function saveCoverPos() {
  const msg = document.getElementById('cover-msg');
  const { x, y } = coverPosEls();
  try {
    await submitJson(`/api/games/${gameIdFromUrl()}`, 'PATCH', {
      coverPosX: Number(x.value),
      coverPosY: Number(y.value),
    });
    savedCoverPos = { x: Number(x.value), y: Number(y.value) };
    refreshCoverSaveState();
    msg.textContent = 'Encuadre guardado';
    setTimeout(() => {
      if (msg.textContent === 'Encuadre guardado') msg.textContent = '';
    }, 2000);
  } catch (err) {
    msg.textContent = err.message;
  }
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

for (const axis of ['cover-pos-x', 'cover-pos-y']) {
  const slider = document.getElementById(axis);
  slider.addEventListener('input', () => {
    applyCoverPos();
    refreshCoverSaveState();
  });
}
document.getElementById('cover-frame-save').addEventListener('click', saveCoverPos);
document.getElementById('cover-frame-reset').addEventListener('click', () => {
  const { x, y } = coverPosEls();
  x.value = 50;
  y.value = 50;
  applyCoverPos();
  refreshCoverSaveState();
});

document.getElementById('log-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.target;
  try {
    const minutes = Math.round(Number(form.hours.value) * 60);
    await submitJson(`/api/games/${gameIdFromUrl()}/sessions`, 'POST', {
      minutes,
      note: form.note.value || undefined,
    });
    form.reset();
    await loadGame();
  } catch (err) {
    alert(err.message);
  }
});

(async () => {
  try {
    const { name } = await (await fetch('/api/profile')).json();
    if (name) document.getElementById('back-link').textContent = `← Biblioteca de ${name}`;
  } catch {
    /* el enlace se queda como "← Biblioteca" */
  }
})();

loadGame();
renderTotalHoursBadge();
