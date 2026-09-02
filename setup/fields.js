// Definición declarativa de lo que pide el wizard, pensada como un pequeño
// tutorial: cada campo trae el enlace directo a la página de donde se saca
// el valor (`url`, que el asistente abre en el navegador) y `guide`, los
// pasos en lenguaje llano. `run.js` los recorre en orden. El README y
// docs/DESIGN.md resumen esto; la fuente es este fichero.

const EPIC_REDIRECT_URL =
  'https://www.epicgames.com/id/api/redirect?clientId=34a02cf8f4414e29b15921876da36f9a&responseType=code';

const GROUPS = [
  {
    id: 'steam',
    title: 'Steam',
    required: true,
    need: 'una clave de API y el enlace de tu perfil · ~2 min',
    intro:
      'SteamDB lee tu biblioteca y tus horas desde la Web API oficial de Steam.\n' +
      'Es lo único imprescindible; el resto de plataformas son opcionales.',
    fields: [
      {
        key: 'STEAM_API_KEY',
        label: 'Clave de la Steam Web API',
        prompt: 'Pega aquí la clave de Steam',
        secret: true,
        url: 'https://steamcommunity.com/dev/apikey',
        guide: [
          '1. Se abrirá la página de claves de Steam (inicia sesión si te lo pide).',
          '2. En "Nombre de dominio" escribe cualquier cosa, por ejemplo:  localhost',
          '3. Marca "Acepto los términos" y pulsa "Registrar".',
          '4. Copia la clave larga que aparece (letras y números) y pégala aquí abajo.',
        ],
      },
      {
        key: 'STEAM_ID',
        label: 'Tu perfil de Steam',
        prompt: 'Pega la dirección de tu perfil (o tu SteamID de 17 dígitos)',
        url: 'https://steamcommunity.com/my/',
        guide: [
          '1. Se abrirá tu perfil de Steam en el navegador.',
          '2. Copia la dirección completa de la barra del navegador; será algo como',
          '   https://steamcommunity.com/id/tunombre   o   https://steamcommunity.com/profiles/7656...',
          '3. Pégala aquí y el asistente saca tu número de cuenta solo.',
          'Ojo: tu perfil y "Detalles del juego" deben estar en modo público',
          '(Steam → Editar perfil → Privacidad) para que la API devuelva la biblioteca.',
        ],
      },
    ],
  },

  {
    id: 'igdb',
    title: 'IGDB — tiempo para completar cada juego (opcional)',
    required: false,
    need: 'crear una aplicación gratis en Twitch · ~3 min',
    intro:
      'IGDB (de Twitch) aporta cuántas horas se tarda en terminar cada juego.\n' +
      'Sin esto la app funciona igual, solo que sin esa columna.',
    fields: [
      {
        key: 'TWITCH_CLIENT_ID',
        label: 'Client ID de una aplicación de Twitch',
        prompt: 'Pega el Client ID',
        url: 'https://dev.twitch.tv/console/apps/create',
        guide: [
          '1. Se abrirá el formulario "Registrar tu aplicación" de Twitch.',
          '   (Inicia sesión; Twitch pedirá activar la verificación en dos pasos de tu cuenta.)',
          '2. Nombre: el que quieras, p. ej.  SteamDB personal',
          '3. URL de redirección de OAuth:  http://localhost',
          '4. Categoría: "Application Integration".   Tipo de cliente: "Confidential".',
          '5. Pulsa "Crear", entra en la aplicación recién creada y copia el "ID de cliente".',
        ],
      },
      {
        key: 'TWITCH_CLIENT_SECRET',
        label: 'Client Secret de esa misma aplicación',
        prompt: 'Pega el Client Secret',
        secret: true,
        url: 'https://dev.twitch.tv/console/apps',
        guide: [
          '1. Abre la aplicación de Twitch que acabas de crear.',
          '2. Pulsa "Nuevo secreto" y confirma.',
          '3. Copia el valor (solo se muestra una vez) y pégalo aquí.',
        ],
      },
    ],
  },

  {
    id: 'xbox',
    title: 'Xbox / Game Pass (opcional)',
    required: false,
    need: 'entrar en xbl.io con tu cuenta de Microsoft · ~2 min',
    intro:
      'Trae los juegos y horas de Xbox / Game Pass a través de OpenXBL (xbl.io),\n' +
      'un puente con Xbox Live que evita toda la cadena de inicios de sesión de Microsoft.',
    fields: [
      {
        key: 'OPENXBL_API_KEY',
        label: 'API key de OpenXBL',
        prompt: 'Pega la API Key de xbl.io',
        secret: true,
        url: 'https://xbl.io/',
        guide: [
          '1. Se abrirá xbl.io. Pulsa "Login" e inicia sesión con tu cuenta de Microsoft (la de Xbox).',
          '2. Acepta el acceso de solo lectura a tu perfil.',
          '3. En tu página de perfil de xbl.io verás un recuadro "API Key". Cópiala y pégala aquí.',
        ],
      },
    ],
  },

  {
    id: 'epic',
    title: 'Epic Games (opcional)',
    required: false,
    special: 'epic',
    need: 'copiar un código de una página de Epic · ~1 min',
    url: EPIC_REDIRECT_URL,
    intro:
      'Epic no tiene API pública: se usa la del propio launcher, igual que\n' +
      'Legendary o Heroic. Solo hay que darle una vez un código de autorización.',
    guide: [
      '1. Se abrirá una página de Epic. Si te pide iniciar sesión, hazlo.',
      '2. Verás un texto tipo   {"redirectUrl":"...","authorizationCode":"XXXX...","sid":"..."}',
      '3. Copia lo que hay entre comillas después de  authorizationCode  y pégalo aquí.',
      '   (Son 32 letras y números y caduca a los ~10 min; si tardas, recarga la página.',
      '    Si te resulta más fácil, pega el texto entero: el asistente saca el código solo.)',
    ],
  },

  {
    id: 'server',
    title: 'Servidor local (opcional)',
    required: false,
    need: 'nada; solo el puerto',
    intro: 'En qué puerto escucha la app en tu equipo.',
    fields: [
      {
        key: 'PORT',
        label: 'Puerto',
        prompt: 'Puerto',
        default: '3000',
        guide: ['Déjalo en 3000 salvo que ese puerto ya esté ocupado en tu máquina.'],
      },
    ],
  },
];

function allKeys() {
  return GROUPS.flatMap((g) => (g.fields || []).map((f) => f.key));
}

module.exports = { GROUPS, allKeys, EPIC_REDIRECT_URL };
