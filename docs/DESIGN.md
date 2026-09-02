# Diseño — SteamDB

## 1. Esquema de base de datos

### `games`

La tabla unificada. Un juego de Steam, uno de Xbox y uno manual son filas
de la misma tabla; se distinguen por `source`. El id que tiene el juego en
su tienda (appid de Steam, product id de GOG, título de Xbox...) no vive
aquí, sino en `game_external_ids`, para que sumar plataformas no sea sumar
columnas.

| columna        | tipo    | notas                                                        |
|----------------|---------|---------------------------------------------------------------|
| id             | INTEGER | PK                                                             |
| source         | TEXT    | `'steam'` \| `'manual'` \| `'epic'` \| `'gog'` \| `'xbox'`    |
| title          | TEXT    | nombre a mostrar                                               |
| platform       | TEXT    | `'Steam'`, `'PS5'`, `'Switch'`... siempre relleno              |
| icon_url       | TEXT    | NULL permitido                                                 |
| created_at     | TEXT    | ISO8601, cuándo se dio de alta en la app                       |
| missing_since  | TEXT    | NULL si está presente; fecha desde la que desapareció de la biblioteca |
| archived       | INTEGER | 0/1, ocultar un juego manual sin borrar su historial            |

Además, columnas `igdb_*` con el tiempo estimado para completarlo (ver
`003_hltb.sql` / `004_igdb.sql`): es un dato 1:1 con el juego, no un
histórico, así que vive como columnas y no como tabla aparte.

`missing_since` lo ponen los flujos de sync (hoy solo Steam). `archived` es
una acción manual del usuario, aplicable a cualquier juego.

### `game_external_ids`

El id de un juego en cada tienda externa. Una fila por `(game_id, source)`.
Sustituye a la vieja columna `games.steam_appid`.

| columna     | tipo    | notas                                          |
|-------------|---------|------------------------------------------------|
| game_id     | INTEGER | FK → games.id                                  |
| source      | TEXT    | `'steam'` \| `'epic'` \| `'gog'` \| `'xbox'`   |
| external_id | TEXT    | el id tal cual en esa tienda (texto siempre)   |

`PRIMARY KEY (game_id, source)`, `UNIQUE (source, external_id)`.

### `playtime_snapshots`

Una fila por cada juego, en cada sincronización. Es el contador acumulado
crudo tal cual lo da la plataforma — nadie fuera de los runners de sync y
de `/db` debería leer esta tabla directamente para calcular estadísticas.
Antes se llamaba `steam_snapshots`.

| columna                   | tipo    | notas                                    |
|----------------------------|---------|-------------------------------------------|
| id                         | INTEGER | PK                                         |
| game_id                    | INTEGER | FK → games.id                              |
| source                     | TEXT    | de qué plataforma viene el contador        |
| captured_at                | TEXT    | ISO8601, momento de la sincronización      |
| playtime_forever_minutes   | INTEGER | contador acumulado que da la plataforma    |
| playtime_2weeks_minutes    | INTEGER | NULL, extra que solo trae Steam            |

`UNIQUE(game_id, captured_at)`.

### `play_sessions`

**La tabla que de verdad consume el resto de la app.** Tanto las sesiones
derivadas de Steam como las introducidas a mano acaban aquí, con la misma
forma. Esto es lo que hace posible que `/core` no sepa nada del origen.

| columna             | tipo    | notas                                                          |
|----------------------|---------|-----------------------------------------------------------------|
| id                   | INTEGER | PK                                                               |
| game_id              | INTEGER | FK → games.id                                                    |
| minutes              | INTEGER | ≥ 0                                                              |
| started_at           | TEXT    | NULL si se desconoce                                             |
| ended_at             | TEXT    | NULL si se desconoce                                             |
| precision            | TEXT    | `'exact'` \| `'approximate'` \| `'derived'`                      |
| origin               | TEXT    | `'steam_sync'` \| `'xbox_sync'` \| `'epic_sync'` \| `'manual'`   |
| source_snapshot_id   | INTEGER | FK → playtime_snapshots.id, NULL si origin='manual'              |
| note                 | TEXT    | NULL, libre                                                       |
| created_at           | TEXT    | auditoría, cuándo se insertó la fila                              |

- `'exact'`: entrada manual con hora de inicio/fin reales.
- `'approximate'`: entrada manual tipo "hoy jugué 3 horas" (se sabe el día,
  no la hora exacta).
- `'derived'`: viene de restar dos instantáneas de Steam. `started_at` /
  `ended_at` son los límites del intervalo entre ambas capturas, **no** el
  momento real de la partida (Steam no lo da).

### Cómo se calcula el tiempo jugado entre dos instantáneas

`/core` expone una función pura:

```
deriveSession(prev: Snapshot | null, curr: Snapshot): { session: SessionDraft | null, anomaly: Anomaly | null }
```

- `curr.minutes > prev.minutes` → sesión normal, `minutes = curr - prev`,
  `started_at = prev.captured_at`, `ended_at = curr.captured_at`.
- `curr.minutes == prev.minutes` → nada que registrar, sin sesión ni anomalía.
- `curr.minutes < prev.minutes` → ver casos raros, más abajo.
- `prev == null` → ver "primera sincronización", más abajo.

Esta función no toca la base de datos: recibe instantáneas como datos y
devuelve, como mucho, un borrador de sesión y/o una anomalía. `/sync` es
quien la llama tras cada sincronización y `/db` quien persiste el resultado.

### `sync_anomalies`

Registro de sucesos raros para poder inspeccionarlos, sin bloquear la
sincronización.

| columna     | tipo    | notas                                                          |
|-------------|---------|------------------------------------------------------------------|
| id          | INTEGER | PK                                                                |
| game_id     | INTEGER | FK → games.id                                                     |
| kind        | TEXT    | `'playtime_decreased'` \| `'game_missing'` \| `'game_reappeared'` |
| detail      | TEXT    | JSON con los valores relevantes (prev/curr, etc.)                 |
| occurred_at | TEXT    | ISO8601                                                            |

### `sync_runs`

Metadatos de cada ejecución de sincronización, para mostrar "última
sincronización" en la UI y detectar fallos repetidos.

| columna       | tipo    | notas                          |
|---------------|---------|----------------------------------|
| id            | INTEGER | PK                                |
| started_at    | TEXT    |                                   |
| finished_at   | TEXT    | NULL si sigue en curso o falló   |
| status        | TEXT    | `'ok'` \| `'error'`               |
| games_synced  | INTEGER |                                   |
| error_message | TEXT    | NULL                              |

## 2. Unificar las plataformas y lo manual sin contaminar el resto de la app

La regla es: **`source` y `game_external_ids` solo se leen en los runners de
sync y en la parte de `/api` que expone el botón "sincronizar" o la insignia
de "vinculado a una tienda".** Todo lo demás —`/core`, las estadísticas, la
UI de lista y detalle de juego— trabaja con dos formas:

- `Game`: `{ id, title, platform, iconUrl, missingSince, archived }`
- `Session`: `{ id, gameId, minutes, startedAt, endedAt, precision }`

Un juego manual y un juego de Steam producen exactamente estas dos formas.
La diferencia de origen ya se resolvió antes de llegar a `/core`:

- `/sync` traduce la respuesta de la Steam Web API a instantáneas, y las
  instantáneas a `Session` vía `deriveSession`.
- El endpoint de entrada manual construye una `Session` directamente a
  partir de lo que escribe el usuario.

Ambas rutas terminan escribiendo en la misma tabla `play_sessions`, así que
cualquier cálculo de agregados (`SUM(minutes) GROUP BY game_id`, evolución
por semana, etc.) es una sola query o una sola función de `/core`, sin
ramas por origen.

## 3. Casos raros

**Un juego desaparece de la biblioteca** (perfil privado, se elimina de la
cuenta, deja de compartirse por family sharing...). En esa sincronización
Steam simplemente no lo incluye en la respuesta de `GetOwnedGames`. No se
inserta instantánea (no hay nada que instantanear). Se marca
`games.missing_since` con la fecha del sync y se registra una anomalía
`game_missing`. El juego y todo su historial se conservan tal cual en la
UI, con una insignia de "ya no está en tu biblioteca de Steam". Si
reaparece en un sync posterior, se limpia `missing_since`, se registra
`game_reappeared`, y la siguiente instantánea se compara contra la última
instantánea conocida antes de desaparecer — el intervalo derivado será
simplemente más ancho de lo normal, lo cual es correcto: no sabemos cuándo
exactamente se jugó dentro de ese hueco, pero el tiempo total sigue siendo
fiable.

**El tiempo jugado baja respecto a la instantánea anterior.** Esto pasa
(raramente) por reseteo de estadísticas del juego, algún glitch puntual de
la API de Steam, o inconsistencias con family sharing. La regla es **no
inventar una sesión negativa ni asumir automáticamente un reseteo**: se
registra una anomalía `playtime_decreased` con los valores anterior/actual
y no se crea ninguna sesión para ese intervalo. El dato histórico ya
guardado no se toca. Si el usuario confirma que fue un reseteo real, la
vía de corrección es una entrada manual explícita (mismo mecanismo que un
juego manual), nunca una heurística automática que adivine qué pasó.

**Primera sincronización de un juego, sin instantánea previa.** Steam ya
trae `playtime_forever` acumulado de antes de que existiera la app. En vez
de perder ese dato o inventarle una fecha de inicio falsa, se crea una
única sesión con `precision='derived'`, `started_at=null` y
`ended_at=<fecha de esta instantánea>`, representando honestamente "todo lo
jugado antes de empezar a hacer seguimiento". Las estadísticas de total
acumulado cuadran desde el primer día; las estadísticas de evolución
temporal simplemente no tienen detalle dentro de ese bloque inicial, lo
cual es correcto porque el detalle no existe.

## 4. Rebanadas verticales

Cada rebanada dejar la app funcionando de punta a punta con lo que tiene
hasta ese momento, y cabe en un commit razonable.

1. **Esqueleto del proyecto.** `package.json`, estructura de carpetas,
   `.env.example`, script que crea/abre la base SQLite, un endpoint de
   salud (`GET /health`) y una página HTML mínima que lo consulta. Sin
   lógica de negocio todavía — solo demostrar que el servidor arranca y
   sirve la UI.
2. **Esquema de base de datos y migraciones.** Script de migración que crea
   `games`, `playtime_snapshots` (entonces `steam_snapshots`),
   `play_sessions`, `sync_anomalies`, `sync_runs`. Sin API todavía; se
   valida con un script/test que corre las migraciones sobre una base
   temporal.
3. **CRUD de juegos manuales, de punta a punta.** API
   (`POST/GET/PATCH /games`, `POST /games/:id/sessions`) + formulario HTML
   mínimo para dar de alta un juego manual y registrar una sesión + tests
   de `/core` para la validación de una sesión manual. Esta es la primera
   rebanada que un usuario real podría usar (sin Steam todavía).
4. **Cliente de Steam, aislado.** `/sync` sabe llamar a
   `GetOwnedGames`/`GetPlayerSummaries` con `STEAM_API_KEY` y traducir la
   respuesta a instantáneas normalizadas. Se prueba con un cliente HTTP
   simulado (sin red real en los tests). Todavía no persiste nada — es
   solo el traductor.
5. **Ingesta de instantáneas.** Comando `npm run sync` que llama al cliente
   de Steam, da de alta juegos nuevos en `games` (`source='steam'`) y
   guarda una fila en `playtime_snapshots` por juego. Sin derivar sesiones
   todavía.
6. **Derivación de sesiones desde instantáneas.** `deriveSession` en
   `/core`, con tests exhaustivos de los casos del punto 3 (primera
   sincronización, bajada de contador, avance normal). Se conecta al flujo
   de `npm run sync`: tras guardar cada instantánea, se deriva y persiste
   la sesión correspondiente en `play_sessions`.
7. **Lista unificada en la UI.** Endpoint y página que muestran todos los
   juegos (Steam + manuales) con su tiempo total jugado, usando
   exclusivamente `games` + `play_sessions` — demuestra que la unificación
   del punto 2 del diseño funciona de verdad.
8. **Juegos que desaparecen y reaparecen.** Lógica en el flujo de sync para
   detectar ausencias, marcar `missing_since`, registrar anomalías, y
   limpiarlo si reaparecen. Insignia correspondiente en la UI.
9. **Detalle e historial por juego.** Página de detalle con la evolución
   temporal (lista/gráfico simple de sesiones) y manejo visible de
   anomalías (`playtime_decreased`, etc.) para ese juego.
10. **Sincronización automática periódica.** Programador simple (intervalo
    configurable) que llama al flujo de sync sin intervención manual,
    registra cada corrida en `sync_runs`, y muestra "última sincronización"
    / errores en la UI.

### Rebanadas posteriores (fuera del plan original)

- **Tiempo para completar cada juego (IGDB).** Columnas `igdb_*` en `games`,
  cliente en `/igdb`, comando `npm run igdb` para rellenarlas en lote y
  botón por juego para corregir. IGDB en vez de HowLongToBeat porque el
  buscador de HLTB tiene barrera anti-bot.
- **Modelo multiplataforma.** `game_external_ids` en vez de
  `games.steam_appid`; `steam_snapshots` → `playtime_snapshots` con
  columna `source`. Deja el terreno listo para Epic, GOG y Xbox sin tocar
  `/core` ni la UI: cada plataforma es un runner nuevo que normaliza a la
  misma forma de instantánea.
- **Xbox / Game Pass.** `xbox/client.js` habla con OpenXBL (xbl.io, un
  puente de terceros con Xbox Live, API key única en vez de la cadena OAuth
  de Microsoft). `xbox/run.js` (`npm run sync:xbox`) da de alta los juegos
  del historial y guarda instantáneas del stat `MinutesPlayed` de cada uno;
  reusa `deriveSession` con `origin='xbox_sync'`. OpenXBL gratis limita a
  ~150 peticiones/hora, así que el runner solo consulta los juegos con
  novedades (sin instantánea o jugados desde la última sync) y, si se queda
  sin presupuesto, para y se retoma en la siguiente pasada.
- **Epic Games.** `epic/client.js` habla con la API privada del launcher
  (credenciales públicas del propio launcher, las de Legendary/Heroic). El
  usuario aporta una vez un código de autorización de su cuenta
  (`npm run epic:login <código>`), que se canjea por un refresh token
  guardado en `data/epic_auth.json` (fuera de git, rueda en cada sync).
  `npm run sync:epic` cruza el listado de horas jugadas con la biblioteca
  para resolver título e imagen, y deriva sesiones con `origin='epic_sync'`.
  Solo cuenta lo lanzado desde el launcher de Epic.
- **Asistente de configuración (`npm run setup`).** CLI guiado en `/setup`
  (sin dependencias: `node:readline`, `node:child_process`). Pensado como
  tutorial para alguien no técnico: recorre grupo por grupo (Steam
  obligatorio; IGDB, Xbox, Epic y puerto opcionales), y por cada clave
  **abre en el navegador la página exacta** (`setup/open-url.js`, best-effort
  por plataforma), da los pasos en lenguaje llano, **limpia** lo pegado
  (`cleanAnswer`: comillas, espacios, prefijo `CLAVE=`, y para Epic saca el
  `authorizationCode` de un JSON entero) y **valida en vivo** contra la API
  antes de guardar. `setup/validate.js` reutiliza los clientes existentes
  (Steam `GetOwnedGames`, resolución de vanity URL / URL de perfil →
  SteamID64, token de Twitch para IGDB, `/account` de OpenXBL,
  `refreshAccessToken` de Epic). `setup/fields.js` es la definición
  declarativa de grupos, enlaces y textos de ayuda (única fuente; el README
  los resume). `setup/env-file.js` (puro) reescribe `.env` sobre
  `.env.example` para conservar los comentarios-guía, con copia a `.env.bak`.
  Al terminar, si Steam quedó validado, se ofrece a lanzar `db/migrate.js` +
  `sync/run.js` (`spawnSync`, salida en directo) para dejar la app lista sin
  más comandos. `npm run setup:check` corre solo los validadores (modo
  doctor, no interactivo, exit 1 si algo configurado falla). Epic se activa
  aquí: el asistente pide el `authorizationCode` y llama a `loginWithCode`.
