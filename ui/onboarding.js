// Bienvenida guiada de primer arranque: explica la app y, paso a paso,
// conecta cada plataforma reutilizando exactamente la misma lógica que
// `npm run setup` (fields.js para la copia, validate.js para comprobar
// contra la API real) pero como una página normal en vez de una consola.

const SHORT_LABEL = { steam: 'Steam', igdb: 'IGDB', xbox: 'Xbox', epic: 'Epic' };

let groups = [];
let status = null;
let steps = [];
let stepIndex = 0;
const results = {}; // groupId -> { state: 'done' | 'skipped', detail }

function shortLabel(group) {
  return SHORT_LABEL[group.id] || group.title;
}

// El contenido de cada paso es un nodo nuevo (en vez de solo cambiar el
// innerHTML) para que la animación de entrada se reproduzca cada vez.
function setStepHTML(html) {
  const old = document.getElementById('onboarding-step');
  const fresh = document.createElement('div');
  fresh.id = 'onboarding-step';
  fresh.className = 'onboarding-step';
  fresh.innerHTML = html;
  old.replaceWith(fresh);
}

function qs(selector) {
  return document.getElementById('onboarding-step').querySelector(selector);
}

function trackedSteps() {
  return steps.filter((s) => s.type === 'group' || s.type === 'epic');
}

function renderTracker() {
  const tracked = trackedSteps();
  const current = steps[stepIndex];
  const html = tracked
    .map((s, i) => {
      const g = s.group;
      const r = results[g.id];
      let cls = 'ob-step-dot';
      let icon = String(i + 1);
      if (s === current) cls += ' is-current';
      else if (r?.state === 'done') {
        cls += ' is-done';
        icon = '✓';
      } else if (r?.state === 'skipped') {
        cls += ' is-skipped';
        icon = '–';
      }
      return `<div class="${cls}"><span class="dot">${icon}</span><span class="label">${escapeHtml(shortLabel(g))}</span></div>`;
    })
    .join('');
  document.getElementById('onboarding-tracker').innerHTML = html;

  const pct = steps.length > 1 ? Math.round((stepIndex / (steps.length - 1)) * 100) : 0;
  document.getElementById('onboarding-progress').style.setProperty('--progress', `${pct}%`);
}

function next() {
  if (stepIndex < steps.length - 1) goTo(stepIndex + 1);
}
function prev() {
  if (stepIndex > 0) goTo(stepIndex - 1);
}

function goTo(index) {
  stepIndex = index;
  renderTracker();
  const step = steps[index];
  if (step.type === 'welcome') renderWelcome();
  else if (step.type === 'group') renderGroup(step.group);
  else if (step.type === 'epic') renderEpic(step.group);
  else renderFinish();
}

function renderWelcome() {
  setStepHTML(`
    <p class="ob-eyebrow">Bienvenido</p>
    <h1>Tu biblioteca de videojuegos, en un solo sitio</h1>
    <p>SteamDB junta cuánto has jugado en Steam, Xbox / Game Pass, Epic Games y GOG,
    y te deja añadir a mano el resto de plataformas (PlayStation, Switch, Mac...).
    Todo en una sola estantería, con las horas siempre al día.</p>
    <p>Steam no guarda un historial de horas: la app hace capturas periódicas del
    contador y calcula sola cuánto jugaste en cada rato. Por eso hace falta conectar
    al menos tu cuenta de Steam — el resto de plataformas son opcionales y se pueden
    añadir luego desde el menú «SteamDB → Configuración».</p>
    <div class="ob-feature-row">
      <span class="ob-feature-pill" style="animation-delay:.05s">🕹️ Steam</span>
      <span class="ob-feature-pill" style="animation-delay:.12s">🎮 Xbox</span>
      <span class="ob-feature-pill" style="animation-delay:.19s">🚀 Epic</span>
      <span class="ob-feature-pill" style="animation-delay:.26s">🧩 GOG</span>
      <span class="ob-feature-pill" style="animation-delay:.33s">✋ Manual</span>
    </div>
    <div class="ob-actions">
      <button type="button" id="ob-start">Empezar →</button>
    </div>
  `);
  qs('#ob-start').addEventListener('click', next);
}

function fieldHtml(field, statusValues) {
  const st = statusValues[field.key];
  const placeholder = st?.filled
    ? `Ya configurado (${st.display}) — déjalo en blanco para no cambiarlo`
    : field.default || '';
  const guide = field.guide
    ? `<ul class="ob-guide">${field.guide.map((l) => `<li>${escapeHtml(l)}</li>`).join('')}</ul>`
    : '';
  const linkBtn = field.url
    ? `<a class="ob-link-btn" href="${field.url}" target="_blank" rel="noopener">🔗 Abrir la página</a>`
    : '';
  return `
    <div class="ob-field">
      <label for="ob-input-${field.key}">${escapeHtml(field.label)}</label>
      ${linkBtn}
      ${guide}
      <input id="ob-input-${field.key}" type="${field.secret ? 'password' : 'text'}"
        placeholder="${escapeHtml(placeholder)}" autocomplete="off">
    </div>`;
}

function renderGroup(group) {
  const fieldsHtml = (group.fields || []).map((f) => fieldHtml(f, status.values)).join('');
  const introHtml = group.intro ? `<p>${escapeHtml(group.intro).replace(/\n/g, '<br>')}</p>` : '';
  const backBtn = stepIndex > 0 ? '<button type="button" class="ob-back" id="ob-back">← Atrás</button>' : '';

  setStepHTML(`
    ${backBtn}
    <p class="ob-eyebrow">${group.required ? 'Obligatorio' : 'Opcional'}</p>
    <h1>${escapeHtml(group.title.replace(/\s*\(opcional\)\s*$/, ''))}</h1>
    ${group.need ? `<div class="ob-need">Necesitas: ${escapeHtml(group.need)}</div>` : ''}
    ${introHtml}
    ${fieldsHtml}
    <div id="ob-result"></div>
    <div class="ob-actions">
      <button type="button" id="ob-check">Comprobar</button>
      <button type="button" id="ob-continue" hidden>Continuar →</button>
      ${group.required ? '' : '<button type="button" class="ob-skip" id="ob-skip">Omitir por ahora</button>'}
    </div>
  `);

  const backEl = qs('#ob-back');
  if (backEl) backEl.addEventListener('click', prev);

  const checkBtn = qs('#ob-check');
  const continueBtn = qs('#ob-continue');
  const resultEl = qs('#ob-result');
  const skipBtn = qs('#ob-skip');
  let toSave = {};

  function collectValues() {
    const values = {};
    for (const f of group.fields) {
      const v = qs(`#ob-input-${f.key}`).value.trim();
      if (v) values[f.key] = v;
    }
    return values;
  }

  checkBtn.addEventListener('click', async () => {
    const values = collectValues();
    checkBtn.disabled = true;
    continueBtn.hidden = true;
    resultEl.innerHTML = '<div class="ob-result"><span class="ob-spinner"></span> comprobando…</div>';
    try {
      const r = await fetch('/api/setup/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groupId: group.id, values }),
      }).then((res) => res.json());

      if (r.ok) {
        resultEl.innerHTML = `<div class="ob-result ok">✔ ${escapeHtml(r.detail || 'correcto')}</div>`;
        toSave = { ...values };
        if (r.steamId) toSave.STEAM_ID = r.steamId;
        continueBtn.hidden = false;
      } else {
        resultEl.innerHTML = `<div class="ob-result error">✗ ${escapeHtml(r.error || 'no se pudo validar')}</div>`;
      }
    } catch (err) {
      resultEl.innerHTML = `<div class="ob-result error">✗ ${escapeHtml(err.message)}</div>`;
    } finally {
      checkBtn.disabled = false;
    }
  });

  continueBtn.addEventListener('click', async () => {
    continueBtn.disabled = true;
    try {
      await fetch('/api/setup/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ values: toSave }),
      });
      results[group.id] = { state: 'done' };
      next();
    } finally {
      continueBtn.disabled = false;
    }
  });

  if (skipBtn) {
    skipBtn.addEventListener('click', () => {
      results[group.id] = { state: 'skipped' };
      next();
    });
  }
}

function renderEpic(group) {
  const already = results.epic?.state === 'done';
  const backBtn = stepIndex > 0 ? '<button type="button" class="ob-back" id="ob-back">← Atrás</button>' : '';
  const alreadyHtml = already
    ? `<div class="ob-result ok">✔ ${escapeHtml(results.epic.detail || 'sesión activa')}</div>`
    : '';

  setStepHTML(`
    ${backBtn}
    <p class="ob-eyebrow">Opcional</p>
    <h1>Epic Games</h1>
    <div class="ob-need">Necesitas: ${escapeHtml(group.need)}</div>
    <p>${escapeHtml(group.intro).replace(/\n/g, '<br>')}</p>
    <a class="ob-link-btn" href="${group.url}" target="_blank" rel="noopener">🔗 Abrir la página de Epic</a>
    <ul class="ob-guide">${group.guide.map((l) => `<li>${escapeHtml(l)}</li>`).join('')}</ul>
    ${alreadyHtml}
    <div class="ob-field">
      <label for="ob-epic-code">Código o texto pegado</label>
      <input id="ob-epic-code" type="text" placeholder="authorizationCode, o el texto entero" autocomplete="off">
    </div>
    <div id="ob-result"></div>
    <div class="ob-actions">
      <button type="button" id="ob-check">Canjear código</button>
      <button type="button" id="ob-continue" hidden>Continuar →</button>
      <button type="button" class="ob-skip" id="ob-skip">${already ? 'Continuar' : 'Omitir por ahora'}</button>
    </div>
  `);

  const backEl = qs('#ob-back');
  if (backEl) backEl.addEventListener('click', prev);

  qs('#ob-check').addEventListener('click', async () => {
    const text = qs('#ob-epic-code').value.trim();
    const resultEl = qs('#ob-result');
    const checkBtn = qs('#ob-check');
    if (!text) {
      resultEl.innerHTML = '<div class="ob-result error">✗ pega el código antes de canjear</div>';
      return;
    }
    checkBtn.disabled = true;
    resultEl.innerHTML = '<div class="ob-result"><span class="ob-spinner"></span> canjeando el código…</div>';
    try {
      const r = await fetch('/api/setup/epic/redeem', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      }).then((res) => res.json());

      if (r.ok) {
        resultEl.innerHTML = `<div class="ob-result ok">✔ ${escapeHtml(r.detail)}</div>`;
        results.epic = { state: 'done', detail: r.detail };
        qs('#ob-continue').hidden = false;
      } else {
        resultEl.innerHTML = `<div class="ob-result error">✗ ${escapeHtml(r.error)}</div>`;
      }
    } catch (err) {
      resultEl.innerHTML = `<div class="ob-result error">✗ ${escapeHtml(err.message)}</div>`;
    } finally {
      checkBtn.disabled = false;
    }
  });

  qs('#ob-continue').addEventListener('click', next);
  qs('#ob-skip').addEventListener('click', () => {
    if (!already) results.epic = { state: 'skipped' };
    next();
  });
}

function renderFinish() {
  const rows = groups
    .map((g) => {
      const r = results[g.id] || { state: 'skipped' };
      const cls = r.state === 'done' ? 'done' : 'skipped';
      const icon = r.state === 'done' ? '✓' : '–';
      const detail = r.state === 'done' ? r.detail || 'configurado' : 'sin configurar';
      return `<li class="${cls}"><span class="ob-summary-icon">${icon}</span><span class="ob-summary-name">${escapeHtml(shortLabel(g))}</span><span class="ob-summary-detail">${escapeHtml(detail)}</span></li>`;
    })
    .join('');

  setStepHTML(`
    <p class="ob-eyebrow">Último paso</p>
    <h1>Todo listo</h1>
    <p>Puedes cambiar cualquier cosa luego desde el menú <strong>SteamDB → Configuración</strong>.</p>
    <ul class="ob-summary-list">${rows}</ul>
    <div id="ob-result"></div>
    <div class="ob-actions">
      <button type="button" id="ob-finish">Sincronizar y entrar a mi biblioteca →</button>
      <button type="button" class="ob-skip" id="ob-enter-plain">Entrar sin sincronizar</button>
    </div>
  `);

  qs('#ob-finish').addEventListener('click', async () => {
    const btn = qs('#ob-finish');
    const resultEl = qs('#ob-result');
    btn.disabled = true;
    resultEl.innerHTML = '<div class="ob-result"><span class="ob-spinner"></span> sincronizando tu biblioteca…</div>';
    try {
      await fetch('/api/sync', { method: 'POST' });
    } catch {
      // la propia biblioteca ya explica el fallo con el botón "Sincronizar"
    }
    window.location.href = '/';
  });
  qs('#ob-enter-plain').addEventListener('click', () => {
    window.location.href = '/';
  });
}

async function init() {
  const [fieldsRes, statusRes] = await Promise.all([
    fetch('/api/setup/fields').then((r) => r.json()),
    fetch('/api/setup/status').then((r) => r.json()),
  ]);
  groups = fieldsRes.groups.filter((g) => g.id !== 'server');
  status = statusRes;

  if (status.epic?.ok) results.epic = { state: 'done', detail: status.epic.detail };
  for (const g of groups) {
    if (g.id === 'epic') continue;
    const allFilled = (g.fields || []).every((f) => status.values[f.key]?.filled);
    if (allFilled) results[g.id] = { state: 'done' };
  }

  steps = [
    { type: 'welcome' },
    ...groups.filter((g) => g.id !== 'epic').map((g) => ({ type: 'group', group: g })),
    { type: 'epic', group: groups.find((g) => g.id === 'epic') },
    { type: 'finish' },
  ];

  goTo(0);
}

init();
