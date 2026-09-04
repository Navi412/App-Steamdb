# SteamDB

Registro personal de videojuegos y horas jugadas. Sincroniza automáticamente
tu biblioteca de **Steam** (y, opcionalmente, **Xbox / Game Pass** y **Epic
Games**) y te deja añadir a mano los juegos del resto de plataformas. Como
Steam solo expone un contador acumulado de horas, la app guarda instantáneas
periódicas y **deriva** de la diferencia cuánto jugaste en cada intervalo.

A cualquier juego se le puede poner una **carátula propia** (subir una
imagen o pegar una URL), tanto al crearlo como después desde su ficha; se
guarda en la base de datos y manda sobre el arte de la tienda.

<p align="center">
  <a href="https://github.com/Navi412/App-Steamdb/releases/latest">
    <img src="https://img.shields.io/github/v/release/Navi412/App-Steamdb?sort=semver&display_name=release&label=Descargar%20para%20Windows&logo=windows&color=2ea44f&style=for-the-badge" alt="Descargar para Windows">
  </a>
</p>

## Descargar la app de escritorio (Windows)

La forma más sencilla si no vas a tocar el código:

1. Abre **[la última release](https://github.com/Navi412/App-Steamdb/releases/latest)**
   y descarga `SteamDB Setup <versión>.exe` (en la sección **Assets**).
2. Doble clic en el `.exe`. Windows SmartScreen puede avisar de que el editor
   es desconocido (el instalador no está firmado): pulsa **Más información →
   Ejecutar de todas formas**.
3. Se abre el asistente de instalación: elige carpeta y crea los accesos
   directos. Al terminar tienes SteamDB en el menú inicio y el escritorio.

No hace falta Node, git ni terminal.

Al abrir la app por primera vez, si no hay Steam configurado se enseña sola
una **bienvenida guiada** dentro de la propia ventana: explica para qué sirve
la app y, paso a paso (con tick verde según se va comprobando cada clave
contra la API real), conecta Steam y — si quieres — Xbox, Epic e IGDB. Puedes
volver a ella cuando quieras desde el menú **SteamDB → Configuración**.

Tus datos (claves, base de datos, sesión de Epic) se guardan en tu carpeta de
usuario (`%APPDATA%\steamdb`), no dentro de la carpeta de instalación —
sobreviven a instalar una versión nueva encima.

Solo hay instalador para Windows por ahora. En macOS/Linux, sigue la vía de
código fuente de abajo.

## Requisitos (código fuente)

- **Node.js 24 o superior** — la app usa el módulo nativo `node:sqlite` sin
  flags. (En 22.5–23 existe pero pide `--experimental-sqlite`; el instalador
  lo comprueba y avisa.) Descárgalo de <https://nodejs.org>.
- **git**, para clonar el repositorio.
- No hay nada que compilar ni bases de datos que instalar aparte.

## Instalación desde el código fuente

```bash
git clone https://github.com/<usuario>/steamdb.git
cd steamdb
npm install
npm run setup
```

- `npm install` no baja casi nada (solo Electron, y es opcional — para saltártelo:
  `npm install --omit=optional`).
- `npm run setup` es un **asistente guiado** de terminal: te abre las webs, te
  explica de dónde sacar cada clave, valida lo que pegas y, al final, se
  ofrece a crear la base de datos y hacer la primera sincronización. Es el
  mismo asistente que `npm start` enseña en el navegador (`/onboarding.html`)
  si todavía no hay Steam configurado — usa el que prefieras.

Cuando termine:

```bash
npm start           # abre http://localhost:3000
npm run electron     # o la app de escritorio (requiere el Electron opcional)
```

¿Algo no cuadra? `npm run setup:check` dice qué falta o qué credencial ha
dejado de valer.

## Configuración (`npm run setup`)

El asistente funciona como un tutorial: para cada clave **abre en tu
navegador la página exacta** de donde se saca, te da los pasos en lenguaje
llano, limpia lo que pegues (comillas, espacios, el JSON entero…) y
**comprueba el valor contra su API al momento**. Escribe el `.env` (con
copia en `.env.bak`) y, si Steam quedó validado, ejecuta `migrate` + `sync`
por ti.

- Puedes volver a correrlo cuando quieras para cambiar algo.
- `npm run setup:check` repasa qué está puesto y si sigue siendo válido, sin tocar nada.
- Editar `.env` a mano también vale; `.env.example` lleva los mismos comentarios.

Enlaces directos y qué se pide en cada uno:

| Plataforma | Qué necesitas | Dónde se saca | ¿Obligatorio? |
|---|---|---|---|
| **Steam** | `STEAM_API_KEY` | <https://steamcommunity.com/dev/apikey> — inicia sesión, pon cualquier dominio (p. ej. `localhost`), acepta y copia la clave (32 hex). | **Sí** |
| **Steam** | `STEAM_ID` | Tu SteamID64 (17 dígitos). El asistente también acepta la URL de tu perfil o tu nombre personalizado y lo resuelve. Tu perfil y "Detalles del juego" deben estar **públicos**. | **Sí** |
| **IGDB** (tiempo para completar cada juego) | `TWITCH_CLIENT_ID` + `TWITCH_CLIENT_SECRET` | <https://dev.twitch.tv/console/apps> → "Registrar tu aplicación". Redirección OAuth `http://localhost`, categoría *Application Integration*, tipo *Confidential*. Copia el Client ID y genera un secreto. | No |
| **Xbox / Game Pass** | `OPENXBL_API_KEY` | <https://xbl.io> → inicia sesión con tu cuenta de Microsoft, autoriza el acceso de solo lectura y copia la *API Key* de tu perfil. | No |
| **Epic Games** | un código de autorización (una sola vez) | Con la sesión de Epic abierta en el navegador, visita la [URL de redirección del launcher](https://www.epicgames.com/id/api/redirect?clientId=34a02cf8f4414e29b15921876da36f9a&responseType=code) y copia `authorizationCode` (caduca en ~10 min). El asistente lo canjea por un token que guarda en `data/epic_auth.json`. | No |

Ninguna clave se sube al repositorio: `.env`, `.env.bak` y `data/epic_auth.json`
están en `.gitignore`.

## Comandos

| Comando | Qué hace |
|---|---|
| `npm run setup` | Asistente de configuración guiado. |
| `npm run setup:check` | Revisa qué credenciales están puestas y si son válidas. |
| `npm run check-node` | Comprueba que tu versión de Node sirve. |
| `npm run migrate` | Aplica las migraciones de la base de datos. |
| `npm start` | Arranca el servidor HTTP (navegador). |
| `npm run electron` | Lo mismo, en ventana de escritorio. |
| `npm run dist` | Genera el instalador de Windows (`dist/SteamDB Setup <versión>.exe`, vía `electron-builder`). Es lo que corre CI al publicar una release. |
| `npm run sync` | Sincroniza Steam (biblioteca, horas y logros). |
| `npm run sync:xbox` | Sincroniza Xbox / Game Pass (incremental; retómalo si avisa). |
| `npm run sync:epic` | Sincroniza Epic Games. |
| `npm run igdb` | Rellena el tiempo estimado para completar cada juego. |
| `npm test` | Tests. |

El botón **Sincronizar** de la interfaz dispara Steam + Xbox + Epic en cadena;
las plataformas sin credenciales se saltan sin romper el resto.

## Publicar una versión nueva (mantenedor)

El instalador se compila y se sube solo a *Releases* con GitHub Actions
([`.github/workflows/release.yml`](.github/workflows/release.yml)) al empujar
un tag `vX.Y.Z`:

```bash
npm version patch      # sube el número en package.json y crea el commit + tag
git push --follow-tags
```

El workflow arranca en un runner de Windows, ejecuta `npm run dist` y adjunta
`SteamDB Setup <versión>.exe` a la release, que pasa a ser la que enlaza el
botón de descarga de arriba. También puede lanzarse a mano desde la pestaña
**Actions → Publicar instalador**, indicando el tag.

## Arquitectura

Ver [`docs/DESIGN.md`](docs/DESIGN.md) para el esquema de datos, la lógica de
derivación de sesiones y los casos límite. Resumen de carpetas:

```
/core   cálculos puros (sesiones, agregados). Sin SQL ni red.
/sync   cliente de la Web API de Steam.
/xbox   cliente de OpenXBL (Xbox Live).
/epic   cliente de la API del launcher de Epic.
/igdb   cliente de IGDB (tiempo para completar).
/db     acceso a SQLite (node:sqlite): migraciones y queries.
/api    servidor HTTP: rutas y orquestación.
/ui     frontend estático.
/setup  asistente de configuración (npm run setup).
/electron  ventana nativa que arranca /api.
```
