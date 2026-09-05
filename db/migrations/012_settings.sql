-- Configuración clave-valor. Pensada para el móvil, que no tiene .env:
-- ahí guarda STEAM_API_KEY y STEAM_ID introducidos a mano en la app. El
-- escritorio sigue usando variables de entorno; esta tabla queda sin usar
-- ahí, pero es la misma base de datos y el mismo módulo db/settings.js.
CREATE TABLE settings (
  key    TEXT PRIMARY KEY,
  value  TEXT NOT NULL
);
