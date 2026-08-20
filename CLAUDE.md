# SteamDB — registro de videojuegos y horas jugadas

Aplicación personal para llevar el registro de videojuegos y horas jugadas,
con sincronización automática desde la API oficial de Steam y entrada manual
para el resto de plataformas.

## Stack

- **Backend**: Node.js (sin framework HTTP pesado — usar `http` nativo o, como
  mucho, una librería mínima tipo `express` solo si el enrutado manual se
  vuelve incómodo; decidir cuando llegue el momento, no antes).
- **Base de datos**: SQLite vía el módulo nativo `node:sqlite` (`DatabaseSync`,
  incluido en Node ≥22.5, sin flags en Node 24). API síncrona, sin
  complicación de promesas para algo que es una app de un solo usuario y
  procesos cortos, y sin dependencia externa ni compilación nativa (se
  evaluó `better-sqlite3`, pero exige un toolchain de compilación que no
  siempre está disponible — `node:sqlite` da lo mismo sin ese coste).
- **Frontend**: HTML/CSS/JS sin framework. Sin bundler salvo que el proyecto
  lo justifique más adelante.
- **Escritorio**: Electron (`/electron`) es solo una ventana nativa que
  arranca el mismo servidor HTTP de `/api` y le apunta a `http://localhost`.
  No duplica lógica: `/core`, `/db`, `/api` y `/ui` no saben que existe.
  `npm start` (navegador) y `npm run electron` (app de escritorio) son dos
  formas de arrancar el mismo backend.
- **Sin dependencias innecesarias.** Antes de añadir un paquete, preguntarse
  si Node ya lo resuelve o si son 20 líneas de código propio. Electron es la
  excepción consciente: es pesado (~200MB), pero es justo lo que pide "app
  de escritorio" sin reescribir nada del resto del proyecto.

## Idea central de la arquitectura

**Steam no expone histórico de horas jugadas.** El endpoint
`GetOwnedGames` solo da un contador acumulado (`playtime_forever`) en el
momento de la consulta. No hay forma de pedir "¿cuánto jugué la semana
pasada?" directamente.

Por eso la app funciona así:

1. `/sync` llama periódicamente a la API de Steam y guarda una **instantánea**
   (snapshot) del contador acumulado de cada juego, con fecha de captura.
2. `/core` toma pares de instantáneas consecutivas del mismo juego y **deriva**
   de la resta cuánto se jugó en ese intervalo. Esa derivación es el corazón
   de la app y debe ser código puro, sin I/O, totalmente testeable.
3. Los juegos manuales no tienen instantáneas: el usuario introduce sesiones
   o totales directamente. `/core` también debe tratar esas entradas con las
   mismas reglas de agregación que las derivadas de Steam, sin que el origen
   del dato se filtre a la capa de estadísticas o a la UI.

Ver `docs/DESIGN.md` para el esquema de datos y los casos límite (juego que
desaparece de la biblioteca, contador que baja, primera sincronización, etc.).

## Estructura de carpetas

```
/core   modelo de dominio y cálculos puros (sesiones, agregados, estadísticas).
        Sin dependencias externas, sin SQL, sin fetch. 100% testeable con
        objetos planos como entrada y salida.
/sync   cliente de la Web API de Steam. Sabe hablar HTTP con Steam y
        traducir sus respuestas a los tipos de datos que /core entiende.
        No sabe nada de SQLite.
/db     acceso a SQLite (node:sqlite): migraciones, queries, mapeo entre
        filas de la base de datos y los tipos de /core.
/api    servidor HTTP: rutas, controladores. Orquesta /db, /sync y /core,
        pero no contiene lógica de negocio propia.
/ui     frontend estático servido por /api.
/electron ventana nativa que arranca /api y carga su URL. No contiene
        lógica propia; ver "Escritorio" arriba.
/tests  tests, organizados en espejo de las carpetas anteriores.
```

Regla de dependencias (una sola dirección, nunca al revés):

```
/ui  →  /api  →  /db
              →  /sync
              →  /core
```

`/core` no importa nada de `/db`, `/sync`, `/api` ni `/ui`. Si un cálculo
necesita datos, se le pasan como argumentos (instantáneas, sesiones, fechas),
nunca haciendo que `/core` vaya a buscarlos él mismo.

## Secretos

La clave de la Steam Web API (`STEAM_API_KEY`) y el SteamID a sincronizar
viven en variables de entorno (`.env`, cargado solo en desarrollo local),
nunca hardcodeadas ni commiteadas. `.env` va en `.gitignore`; se mantiene un
`.env.example` con las claves necesarias sin valores reales.

## Convenciones de trabajo

- Cada slice vertical (ver `docs/DESIGN.md`) debe dejar la app funcionando
  de punta a punta, del tamaño de un commit razonable.
- La lógica de negocio (cálculo de sesiones, agregados, detección de casos
  raros) se testea en `/core` con tests unitarios puros, sin base de datos
  ni red de por medio.
- No añadir abstracciones (frameworks de ORM, sistemas de plugins, etc.)
  antes de que el proyecto las necesite de verdad.
