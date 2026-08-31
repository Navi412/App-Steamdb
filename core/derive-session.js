// Núcleo del proyecto: traduce un par de instantáneas del contador
// acumulado de horas en, como mucho, una sesión derivada y/o una anomalía.
// Pura: nada de I/O, nada de SQL, nada de red. Ver docs/DESIGN.md § "cómo
// se calcula el tiempo jugado entre dos instantáneas" para el razonamiento
// de cada caso.
//
// prev: { capturedAt, playtimeForeverMinutes } | null
// curr: { capturedAt, playtimeForeverMinutes }
// origin: qué flujo generó la sesión ('steam_sync', 'xbox_sync'...).
function deriveSession(prev, curr, origin = 'steam_sync') {
  if (prev === null) {
    if (curr.playtimeForeverMinutes > 0) {
      // Primera instantánea de este juego: la plataforma ya trae acumulado
      // el tiempo jugado antes de que existiera el seguimiento. Se registra
      // como un bloque sin fecha de inicio conocida, en vez de perderlo
      // o inventarle un principio falso.
      return {
        session: {
          minutes: curr.playtimeForeverMinutes,
          startedAt: null,
          endedAt: curr.capturedAt,
          precision: 'derived',
          origin,
          note: null,
        },
        anomaly: null,
      };
    }
    return { session: null, anomaly: null };
  }

  const delta = curr.playtimeForeverMinutes - prev.playtimeForeverMinutes;

  if (delta > 0) {
    return {
      session: {
        minutes: delta,
        startedAt: prev.capturedAt,
        endedAt: curr.capturedAt,
        precision: 'derived',
        origin,
        note: null,
      },
      anomaly: null,
    };
  }

  if (delta === 0) {
    return { session: null, anomaly: null };
  }

  // delta < 0: el contador bajó (reseteo de stats, glitch de la API,
  // family sharing...). No se inventa una sesión negativa ni se asume
  // automáticamente qué pasó: se deja constancia como anomalía para que
  // el usuario lo revise; una corrección real se hace como sesión manual.
  return {
    session: null,
    anomaly: {
      kind: 'playtime_decreased',
      detail: JSON.stringify({
        previousMinutes: prev.playtimeForeverMinutes,
        currentMinutes: curr.playtimeForeverMinutes,
        previousCapturedAt: prev.capturedAt,
        currentCapturedAt: curr.capturedAt,
      }),
    },
  };
}

module.exports = { deriveSession };
