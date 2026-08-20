function buildManualSession({ minutes, startedAt, endedAt, note } = {}) {
  if (!Number.isInteger(minutes) || minutes <= 0) {
    throw new Error('minutes debe ser un entero positivo');
  }

  const hasStart = startedAt !== undefined && startedAt !== null && startedAt !== '';
  const hasEnd = endedAt !== undefined && endedAt !== null && endedAt !== '';

  if (hasStart !== hasEnd) {
    throw new Error('startedAt y endedAt deben darse juntos o no darse');
  }

  const cleanNote = typeof note === 'string' ? note.trim() : '';

  return {
    minutes,
    startedAt: hasStart ? startedAt : null,
    endedAt: hasEnd ? endedAt : null,
    // con horas exactas la precisión es 'exact'; sin ellas, solo sabemos
    // cuántos minutos se jugaron, no cuándo dentro del día ('approximate').
    precision: hasStart ? 'exact' : 'approximate',
    origin: 'manual',
    note: cleanNote || null,
  };
}

module.exports = { buildManualSession };
