const { openDatabase } = require('../db/connection');
const { migrate } = require('../db/migrate');
const gamesDb = require('../db/games');
const igdbClient = require('./client');
const { rankedMatches } = require('../core/igdb');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// IGDB permite 4 peticiones/segundo. Cada juego gasta 2 (buscar + tiempos),
// alguno alguna mas al desempatar duplicados, asi que se espera un poco
// entre juegos para no chocar con el limite.
const DELAY_BETWEEN_GAMES_MS = 350;

// Cuantas entradas duplicadas de IGDB se consultan como mucho buscando una
// que traiga tiempos, antes de quedarse con la primera.
const MAX_CANDIDATES_PER_GAME = 3;

function hasTimes(times) {
  return times.mainMinutes != null || times.completionistMinutes != null;
}

// Recorre los juegos y rellena sus tiempos de IGDB. Por defecto solo toca
// los que aun no tienen igdb_id; con force = true revisa todos otra vez.
// Un fallo con un juego concreto no aborta el resto (igual que la sync de
// Steam): se cuenta y se sigue.
async function enrichGamesWithIgdb({
  db,
  clientId,
  clientSecret,
  fetchImpl,
  force = false,
  log = () => {},
  delayMs = DELAY_BETWEEN_GAMES_MS,
} = {}) {
  const credentials = { clientId, clientSecret, fetchImpl };
  const pending = gamesDb.listGames(db).filter((g) => force || !g.igdbId);

  const stats = { total: pending.length, updated: 0, withTimes: 0, notFound: 0, failed: 0 };

  for (const game of pending) {
    try {
      const candidates = rankedMatches(await igdbClient.searchGame(game.title, credentials), game.title);
      if (candidates.length === 0) {
        stats.notFound += 1;
        log(`sin match en IGDB: ${game.title}`);
        continue;
      }

      let chosen = candidates[0];
      let times = { mainMinutes: null, completionistMinutes: null };
      for (const candidate of candidates.slice(0, MAX_CANDIDATES_PER_GAME)) {
        const t = await igdbClient.getTimeToBeat(candidate.igdbId, credentials);
        if (hasTimes(t)) {
          chosen = candidate;
          times = t;
          break;
        }
      }

      gamesDb.setIgdbTimes(db, game.id, {
        igdbId: chosen.igdbId,
        mainMinutes: times.mainMinutes,
        completionistMinutes: times.completionistMinutes,
      });
      stats.updated += 1;
      if (hasTimes(times)) {
        stats.withTimes += 1;
        const main = times.mainMinutes ? `${(times.mainMinutes / 60).toFixed(1)} h` : '?';
        log(`${game.title} -> ${main}`);
      } else {
        log(`${game.title} -> IGDB no tiene tiempo estimado`);
      }
    } catch (err) {
      stats.failed += 1;
      log(`fallo con "${game.title}": ${err.message}`);
    }

    if (delayMs > 0) await sleep(delayMs);
  }

  return stats;
}

if (require.main === module) {
  const force = process.argv.includes('--force');
  const db = openDatabase();
  migrate(db);

  enrichGamesWithIgdb({
    db,
    clientId: process.env.TWITCH_CLIENT_ID,
    clientSecret: process.env.TWITCH_CLIENT_SECRET,
    force,
    log: (line) => console.log(`  ${line}`),
  })
    .then((s) => {
      console.log(
        `\nIGDB: ${s.updated}/${s.total} juegos procesados, ${s.withTimes} con tiempo, ` +
          `${s.notFound} sin match, ${s.failed} con error`
      );
    })
    .catch((err) => {
      console.error(`fallo el enriquecimiento con IGDB: ${err.message}`);
      process.exitCode = 1;
    });
}

module.exports = { enrichGamesWithIgdb };
