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

module.exports = { validateManualGame, validateGameUpdate };
