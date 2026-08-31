function validateManualGame({ title, platform } = {}) {
  const cleanTitle = typeof title === 'string' ? title.trim() : '';
  const cleanPlatform = typeof platform === 'string' ? platform.trim() : '';

  if (!cleanTitle) throw new Error('title es obligatorio');
  if (!cleanPlatform) throw new Error('platform es obligatorio');

  return { title: cleanTitle, platform: cleanPlatform };
}

function validateGameUpdate(changes = {}) {
  const result = {};

  if (changes.title !== undefined) {
    const cleanTitle = typeof changes.title === 'string' ? changes.title.trim() : '';
    if (!cleanTitle) throw new Error('title no puede quedar vacío');
    result.title = cleanTitle;
  }

  if (changes.platform !== undefined) {
    const cleanPlatform = typeof changes.platform === 'string' ? changes.platform.trim() : '';
    if (!cleanPlatform) throw new Error('platform no puede quedar vacío');
    result.platform = cleanPlatform;
  }

  if (changes.archived !== undefined) {
    result.archived = Boolean(changes.archived);
  }

  return result;
}

function validatePositiveMinutesOrNull(value, field) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw new Error(`${field} debe ser un número ≥ 0`);
  return Math.round(n);
}

// A diferencia de validateGameUpdate, esto siempre devuelve ambos campos
// (nunca "sin cambios"): el formulario de IGDB en la UI envía los dos a la
// vez, y dejar uno en blanco significa "borrar ese tiempo", no "no tocarlo".
function validateIgdbUpdate({ mainMinutes, completionistMinutes } = {}) {
  return {
    mainMinutes: validatePositiveMinutesOrNull(mainMinutes, 'mainMinutes'),
    completionistMinutes: validatePositiveMinutesOrNull(completionistMinutes, 'completionistMinutes'),
  };
}

module.exports = { validateManualGame, validateGameUpdate, validateIgdbUpdate };
