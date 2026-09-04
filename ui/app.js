async function loadLibraryTitle() {
  const el = document.getElementById('library-title');
  try {
    const { name } = await (await fetch('/api/profile')).json();
    el.textContent = name ? `Biblioteca de ${name}` : 'Mi biblioteca';
    if (name) document.title = `Biblioteca de ${name}`;
  } catch {
    el.textContent = 'Mi biblioteca';
  }
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

// 'all' = toda la biblioteca; 'toplay' = solo la lista de siguientes.
let currentTab = 'all';

function applyView() {
  const term = document.getElementById('search-input').value.trim().toLowerCase();
  const platform = document.getElementById('platform-filter').value;
  const sort = document.getElementById('sort-order').value;

  let games = currentTab === 'toplay' ? allGames.filter((g) => g.inToPlay) : allGames;
  if (term) games = games.filter((g) => g.title.toLowerCase().includes(term));
  if (platform) games = games.filter((g) => (g.platforms || [g.platform]).includes(platform));

  const empty =
    currentTab === 'toplay'
      ? 'Tu lista está vacía. Arrastra juegos aquí desde «Mis juegos».'
      : 'Ningún juego coincide con la búsqueda.';

  renderGames([...games].sort(SORTERS[sort] || SORTERS.title), empty);
}

// Cada juego es una "caja" física: casi todo carátula. Las horas, los
// logros y la info básica solo aparecen en el panel que sube al pasar el
// ratón; para tocar nada (carátula, sesiones...) se entra a la ficha.
function caseHtml(game) {
  const platforms = game.platforms || [game.platform];
  const chips = [
    `<span class="chip total">⏱ ${formatHours(game.totalMinutes)}</span>`,
    game.achievementsTotal > 0
      ? `<span class="chip ach">🏆 ${game.achievementsUnlocked}/${game.achievementsTotal}</span>`
      : '',
    game.igdbMainMinutes ? `<span class="chip igdb">▶ ${formatHours(game.igdbMainMinutes)}</span>` : '',
    ...platforms.map((p) => `<span class="chip plat">${escapeHtml(p)}</span>`),
  ].join('');

  return `
    <a class="case" href="/game.html?id=${game.id}" draggable="true" data-id="${game.id}">
      <span class="case-art">${coverHtml(game, { size: 'case' })}</span>
      <span class="case-spine" aria-hidden="true"></span>
      <span class="case-gloss" aria-hidden="true"></span>
      ${game.missingSince ? '<span class="case-flag">fuera de Steam</span>' : ''}
      ${game.inToPlay && currentTab !== 'toplay' ? '<span class="case-next" title="En tu lista de siguientes">▶</span>' : ''}
      <span class="case-label">${escapeHtml(game.title)}</span>
      <span class="case-info">
        <span class="case-info-title">${escapeHtml(game.title)}</span>
        <span class="case-chips">${chips}</span>
        <span class="case-cta">Abrir ficha →</span>
      </span>
    </a>
  `;
}

function renderGames(games, emptyMessage) {
  const list = document.getElementById('games-list');

  if (games.length === 0) {
    list.innerHTML = `<li class="empty">${escapeHtml(emptyMessage || 'Sin juegos.')}</li>`;
    return;
  }

  list.innerHTML = games
    .map((game, i) => {
      const remove =
        currentTab === 'toplay'
          ? `<button class="case-remove" type="button" data-remove="${game.id}" title="Quitar de la lista">×</button>`
          : '';
      return `<li class="case-slot${game.archived ? ' archived' : ''}" style="--i:${Math.min(i, 40)}">${caseHtml(game)}${remove}</li>`;
    })
    .join('');
}

async function refreshGames() {
  allGames = await fetchGames();
  refreshPlatformOptions();

  const nextCount = allGames.filter((g) => g.inToPlay).length;
  document.getElementById('toplay-count').textContent = nextCount;
  const roulette = document.getElementById('roulette-button');
  roulette.disabled = nextCount === 0;
  roulette.hidden = currentTab !== 'toplay';

  applyView();
  renderTotalHoursFromGames(allGames);
}

// --- pestañas: "Mis juegos" / "Lista de siguientes" ---
document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    if (tab.classList.contains('is-active')) return;
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('is-active', t === tab));
    currentTab = tab.dataset.tab;
    document.body.classList.toggle('tab-toplay', currentTab === 'toplay');
    document.getElementById('roulette-button').hidden = currentTab !== 'toplay';
    applyView();
  });
});

// --- arrastrar un juego a la "Lista de siguientes" ---
const dropNext = document.getElementById('drop-next');
const gamesList = document.getElementById('games-list');

gamesList.addEventListener('dragstart', (event) => {
  const card = event.target.closest('.case');
  if (!card) return;
  event.dataTransfer.setData('text/plain', card.dataset.id);
  event.dataTransfer.effectAllowed = 'copy';
  document.body.classList.add('dragging-game');
  // solo tiene sentido añadir a la lista desde "Mis juegos"
  if (currentTab === 'all') dropNext.classList.add('show');
});

gamesList.addEventListener('dragend', () => {
  document.body.classList.remove('dragging-game');
  dropNext.classList.remove('show', 'is-over');
});

dropNext.addEventListener('dragover', (event) => {
  event.preventDefault();
  event.dataTransfer.dropEffect = 'copy';
  dropNext.classList.add('is-over');
});
dropNext.addEventListener('dragleave', () => dropNext.classList.remove('is-over'));
dropNext.addEventListener('drop', async (event) => {
  event.preventDefault();
  const id = Number(event.dataTransfer.getData('text/plain'));
  dropNext.classList.remove('show', 'is-over');
  document.body.classList.remove('dragging-game');
  if (!id) return;
  try {
    await submitJson('/api/to-play', 'POST', { gameId: id });
    await refreshGames();
  } catch (err) {
    alert(err.message);
  }
});

// --- quitar de la lista (botón "×" en la pestaña de siguientes) ---
gamesList.addEventListener('click', async (event) => {
  const btn = event.target.closest('.case-remove');
  if (!btn) return;
  event.preventDefault();
  try {
    await submitJson(`/api/to-play/${btn.dataset.remove}`, 'DELETE', {});
    await refreshGames();
  } catch (err) {
    alert(err.message);
  }
});

const addGameForm = document.getElementById('add-game-form');
const coverNameLabel = document.getElementById('cover-name');
const platformSelect = document.getElementById('platform-select');
const platformOther = document.getElementById('platform-other');

addGameForm.cover.addEventListener('change', () => {
  coverNameLabel.textContent = addGameForm.cover.files[0]?.name || '';
});

// "Otra…" en el desplegable revela el campo de texto libre. Además, el
// borde del selector toma el color del grupo (PC, PlayStation...) ya
// pintado en el optgroup, para que el desplegable siga la paleta del tema.
platformSelect.addEventListener('change', () => {
  const isOther = platformSelect.value === '__other__';
  platformOther.hidden = !isOther;
  platformOther.required = isOther;
  if (isOther) platformOther.focus();

  const group = platformSelect.selectedOptions[0]?.closest('optgroup');
  platformSelect.style.borderColor = group ? group.style.color : '';
});

addGameForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.target;
  try {
    const platform = platformSelect.value === '__other__' ? platformOther.value.trim() : platformSelect.value;
    const game = await submitJson('/api/games', 'POST', {
      title: form.title.value,
      platform,
    });
    const file = form.cover.files[0];
    if (file) {
      await saveCover(game.id, { dataUrl: await readFileAsDataUrl(file) });
    }
    form.reset();
    coverNameLabel.textContent = '';
    platformOther.hidden = true;
    platformOther.required = false;
    platformSelect.style.borderColor = '';
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

// --- ruleta: elige al azar el próximo juego de la lista de siguientes ---
const rouletteModal = document.getElementById('roulette-modal');
const wheel = document.getElementById('wheel');
const wheelResult = document.getElementById('wheel-result');
const wheelSpin = document.getElementById('wheel-spin');
const wheelGo = document.getElementById('wheel-go');
let wheelGames = [];
let wheelRotation = 0;
let wheelSpinning = false;

function buildWheel(games) {
  const n = games.length;
  const seg = 360 / n;
  const R = 118; // radio del anillo de nombres (la ruleta mide 300)

  // Separadores radiales entre sectores.
  const seps = [];
  for (let i = 0; i < n; i++) {
    seps.push(`<div class="wheel-sep" style="transform:rotate(${i * seg}deg)"></div>`);
  }

  // Nombres curvados sobre la circunferencia (SVG textPath). El arco se
  // recorre en sentido antihorario desde arriba, así el texto "mira" al
  // centro del disco. startOffset coloca cada título en el medio de su sector.
  const fontPx = n > 10 ? 10 : n > 6 ? 11 : 12;
  const wedgeArc = (2 * Math.PI * R) / n; // px disponibles por título
  const maxChars = Math.max(6, Math.floor(wedgeArc / (fontPx * 0.62)));
  const texts = games
    .map((g, i) => {
      const mid = i * seg + seg / 2; // grados desde arriba, sentido horario
      const offset = (((360 - mid) / 360) * 100).toFixed(3);
      const t =
        g.title.length > maxChars ? g.title.slice(0, maxChars - 1).trimEnd() + '…' : g.title;
      return `<text style="font-size:${fontPx}px"><textPath href="#wheel-arc" startOffset="${offset}%" text-anchor="middle">${escapeHtml(t)}</textPath></text>`;
    })
    .join('');

  const svg =
    `<svg class="wheel-svg" viewBox="0 0 300 300" aria-hidden="true">` +
    `<defs><path id="wheel-arc" fill="none" d="M 150 ${150 - R} A ${R} ${R} 0 1 0 150 ${150 + R} A ${R} ${R} 0 1 0 150 ${150 - R}"/></defs>` +
    `<g class="wheel-svg-labels">${texts}</g>` +
    `</svg>`;

  wheel.classList.toggle('dense', n > 16);
  wheel.innerHTML = seps.join('') + svg;

  wheelRotation = 0;
  wheel.style.transition = 'none';
  wheel.style.transform = 'rotate(0deg)';
  void wheel.offsetWidth; // fuerza el reflow para que la próxima transición cuente
  wheel.style.transition = '';
}

function openRoulette() {
  wheelGames = allGames.filter((g) => g.inToPlay);
  if (wheelGames.length === 0) return;
  buildWheel(wheelGames);
  wheelResult.textContent = 'Gira la ruleta…';
  wheelGo.hidden = true;
  wheelSpin.disabled = false;
  wheelSpin.textContent = 'Girar';
  rouletteModal.hidden = false;
}

function closeRoulette() {
  rouletteModal.hidden = true;
}

function spinWheel() {
  const n = wheelGames.length;
  if (wheelSpinning || n === 0) return;
  wheelSpinning = true;

  const seg = 360 / n;
  const pick = Math.floor(Math.random() * n);
  const jitter = (Math.random() - 0.5) * seg * 0.6;
  // La aguja del brazo toca el disco a las 3 en punto (90° desde arriba).
  const NEEDLE_DEG = 90;
  const targetMod = (((NEEDLE_DEG - (pick * seg + seg / 2 + jitter)) % 360) + 360) % 360;
  let rot = wheelRotation - (wheelRotation % 360) + targetMod;
  while (rot < wheelRotation + 360 * 6) rot += 360;
  wheelRotation = rot;

  wheelSpin.disabled = true;
  wheelGo.hidden = true;
  wheelResult.textContent = 'Girando…';

  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    wheelSpinning = false;
    const g = wheelGames[pick];
    wheelResult.innerHTML = `Te toca jugar a <strong>${escapeHtml(g.title)}</strong>`;
    wheelGo.href = `/game.html?id=${g.id}`;
    wheelGo.hidden = false;
    wheelSpin.disabled = false;
    wheelSpin.textContent = 'Girar otra vez';
  };
  wheel.addEventListener('transitionend', finish, { once: true });
  const noAnim = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  setTimeout(finish, noAnim ? 350 : 5200); // sin transición o si se pierde el evento

  wheel.style.transform = `rotate(${rot}deg)`;
}

document.getElementById('roulette-button').addEventListener('click', openRoulette);
document.getElementById('roulette-close').addEventListener('click', closeRoulette);
rouletteModal.addEventListener('click', (event) => {
  if (event.target === rouletteModal) closeRoulette();
});
wheelSpin.addEventListener('click', spinWheel);
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !rouletteModal.hidden) closeRoulette();
});

// --- ajustes: plataformas conectadas + tema de la interfaz ---
const settingsModal = document.getElementById('settings-modal');
const settingsPlatformList = document.getElementById('settings-platform-list');
const themeSwatchesEl = document.getElementById('theme-swatches');
const themeBgFile = document.getElementById('theme-bg-file');
const themeBgRemove = document.getElementById('theme-bg-remove');
const themeBgName = document.getElementById('theme-bg-name');

// Mismos grupos que la bienvenida guiada (/onboarding.html): un resumen en
// miniatura de qué está conectado, con el mismo componente de lista con
// ticks que ya usa el paso final del asistente.
const SETTINGS_PLATFORM_LABELS = { steam: 'Steam', igdb: 'IGDB', xbox: 'Xbox', epic: 'Epic' };

async function renderSettingsPlatforms() {
  settingsPlatformList.innerHTML = '<li><span class="ob-summary-detail">Comprobando…</span></li>';
  try {
    const [fields, status] = await Promise.all([
      fetch('/api/setup/fields').then((r) => r.json()),
      fetch('/api/setup/status').then((r) => r.json()),
    ]);
    const rows = fields.groups
      .filter((g) => g.id in SETTINGS_PLATFORM_LABELS)
      .map((g) => {
        const done = g.id === 'epic' ? status.epic?.ok : (g.fields || []).every((f) => status.values[f.key]?.filled);
        return `<li class="${done ? 'done' : 'skipped'}"><span class="ob-summary-icon">${done ? '✓' : '–'}</span><span class="ob-summary-name">${escapeHtml(SETTINGS_PLATFORM_LABELS[g.id])}</span><span class="ob-summary-detail">${done ? 'conectado' : 'sin configurar'}</span></li>`;
      })
      .join('');
    settingsPlatformList.innerHTML = rows;
  } catch {
    settingsPlatformList.innerHTML = '<li><span class="ob-summary-detail">No se pudo comprobar el estado.</span></li>';
  }
}

function renderThemeSwatches() {
  const current = getStoredTheme();
  themeSwatchesEl.innerHTML = THEMES.map(
    (t) => `
      <button type="button" class="theme-swatch${t.id === current ? ' is-active' : ''}" data-theme-id="${t.id}">
        <span class="theme-swatch-check" aria-hidden="true">✓</span>
        <span class="theme-swatch-preview" style="background:${t.preview}"></span>
        <span class="theme-swatch-name">${escapeHtml(t.name)}</span>
      </button>`
  ).join('');
}

function refreshThemeBgControls() {
  const hasBg = !!getStoredBgImage();
  themeBgRemove.hidden = !hasBg;
  themeBgName.textContent = hasBg ? 'Imagen de fondo activa' : 'Sin imagen personalizada';
}

function openSettingsModal() {
  renderSettingsPlatforms();
  renderThemeSwatches();
  refreshThemeBgControls();
  settingsModal.hidden = false;
}

function closeSettingsModal() {
  settingsModal.hidden = true;
}

document.getElementById('settings-button').addEventListener('click', openSettingsModal);
document.getElementById('settings-close').addEventListener('click', closeSettingsModal);
settingsModal.addEventListener('click', (event) => {
  if (event.target === settingsModal) closeSettingsModal();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !settingsModal.hidden) closeSettingsModal();
});

themeSwatchesEl.addEventListener('click', (event) => {
  const btn = event.target.closest('.theme-swatch');
  if (!btn) return;
  setTheme(btn.dataset.themeId);
  renderThemeSwatches();
});

themeBgFile.addEventListener('change', async () => {
  const file = themeBgFile.files[0];
  if (!file) return;
  try {
    const dataUrl = await readImageAsBackgroundDataUrl(file);
    setBgImage(dataUrl);
    refreshThemeBgControls();
  } catch (err) {
    alert(err.message);
  } finally {
    themeBgFile.value = '';
  }
});

themeBgRemove.addEventListener('click', () => {
  clearBgImage();
  refreshThemeBgControls();
});

loadLibraryTitle();
checkHealth();
refreshGames();
