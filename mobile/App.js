import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  BackHandler,
  FlatList,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

// Fase 2: el móvil sincroniza directamente contra la Steam Web API (mismo
// core/sync/db que el escritorio, sin tocar una línea) en vez de depender
// de que el PC esté encendido y accesible en la misma red. Las
// credenciales no vienen de un .env (el móvil no tiene uno) sino que se
// guardan en la propia base de datos local (tabla settings, migración 012).
//
// Fase 3: la lista muestra el icono de Steam (URL absoluta del CDN, ya
// calculada por sync/normalize.js — no depende del servidor /api local) y
// el progreso de logros que la sync ya guarda en /db/achievements. La
// carátula subida a mano (coverUrl) sí depende de /api corriendo en el PC,
// así que de momento el móvil no la usa.
//
// Fase 4: Xbox se suma igual que Steam (OpenXBL habla HTTP puro, sin login
// OAuth) reutilizando /xbox/run.js tal cual.
//
// Fase 5: Epic también se suma. El login es un código de un solo uso (dura
// ~10 min, pero solo hace falta pegarlo una vez: el refresh token que
// devuelve dura ~23 días y se renueva solo en cada sync). El único cambio
// necesario en epic/run.js fue hacer inyectable dónde se guarda ese
// refresh token (antes solo sabía escribir a un fichero vía node:fs, que
// no existe en Expo) — aquí se guarda como una fila más de /db/settings.js.
// GOG se queda fuera: no tiene API, Galaxy solo guarda las horas en su
// propia base SQLite local dentro del PC, y no hay forma de leer eso desde
// el teléfono.
//
// Fase 6: pestañas "Lista de siguientes" / "Jugando ahora" (db/to-play.js,
// db/playing-now.js) y ficha de cada juego (sesiones y logros vía
// db/sessions.js y db/achievements.js) — mismos módulos que usa /api,
// reutilizados tal cual porque solo hablan con `db` y no con node:fs. La
// ruleta no reutiliza nada del escritorio (esa sí que es DOM/CSS puro) pero
// sigue las mismas dos listas como fuente de datos.
//
// Fase 7: Ajustes se parte en dos pestañas ("Cuentas" / "Apariencia") igual
// que el escritorio separa credenciales y tema en su modal de Ajustes. La
// paleta reutiliza los mismos 7 temas y colores exactos de ui/common.js +
// ui/styles.css, pero aquí no hay custom properties de CSS que redefinir:
// los colores viven en `THEMES` y el StyleSheet se reconstruye con
// `createStyles(colors)` cada vez que cambia el tema (ver `colors`/`styles`
// dentro de App). El fondo personalizado del escritorio (subir una imagen)
// se queda fuera: exigiría una librería de selección de imágenes nueva
// (expo-image-picker) solo para esto.
//
// También: el botón atrás físico/gesto de Android salía de la app entera
// en vez de volver a la pantalla anterior (comportamiento por defecto de
// React Native, que no sabe nada de nuestra navegación manual por
// `view`). Se intercepta con BackHandler para que desde la ficha de un
// juego o desde Ajustes vuelva a la biblioteca en la pestaña en la que
// estabas, igual que el botón "← Volver".
// Envuelto en try/catch porque un fallo aquí (p.ej. un require que Metro
// empaquetó pero que revienta al ejecutarse en el dispositivo) pasaba antes
// desapercibido: ocurre al evaluar el módulo, antes de que exista ningún
// componente que lo capture, así que sin esto la app se queda en una
// pantalla negra sin ninguna pista de qué falló.
let openDatabase, migrate, gamesDb, settingsDb, groupGames, validateManualGame;
let runSync, runXboxSync, runEpicSync, loginWithCode;
let toPlayDb, playingNowDb, sessionsDb, achievementsDb, buildManualSession;
let bootError = null;
try {
  ({ openDatabase } = require('./db/connection'));
  ({ migrate } = require('./db/migrate'));
  gamesDb = require('../db/games');
  settingsDb = require('../db/settings');
  toPlayDb = require('../db/to-play');
  playingNowDb = require('../db/playing-now');
  sessionsDb = require('../db/sessions');
  achievementsDb = require('../db/achievements');
  ({ groupGames } = require('../core/group-games'));
  ({ validateManualGame } = require('../core/game'));
  ({ buildManualSession } = require('../core/session'));
  ({ runSync } = require('../sync/run'));
  ({ runXboxSync } = require('../xbox/run'));
  ({ runEpicSync, loginWithCode } = require('../epic/run'));
} catch (err) {
  bootError = err;
}

// URLs de donde se saca cada credencial, igual que setup/fields.js (el
// wizard de escritorio) pero duplicadas aquí: fields.js está pensado para
// recorrerse desde una terminal, y el móvil solo necesita los enlaces.
const HELP_URLS = {
  steamApiKey: 'https://steamcommunity.com/dev/apikey',
  steamProfile: 'https://steamcommunity.com/my/',
  openxbl: 'https://xbl.io/',
  epic: 'https://www.epicgames.com/id/api/redirect?clientId=34a02cf8f4414e29b15921876da36f9a&responseType=code',
};

function openHelpUrl(url) {
  Linking.openURL(url).catch(() => {});
}

// Igual que setup/validate.js -> extractEpicCode, duplicado aquí en vez de
// importado: ese módulo también carga epic/file-auth-store.js (node:fs),
// que Metro no sabe empaquetar.
function extractEpicCode(raw) {
  const match = String(raw || '').match(/authorizationCode["']?\s*[:=]\s*["']?([A-Za-z0-9]{16,})/i);
  const code = (match ? match[1] : raw) || '';
  return code.replace(/[^A-Za-z0-9]/g, '');
}

// Igual que setup/validate.js -> resolveSteamId, duplicado aquí por la misma
// razón que extractEpicCode (ese módulo también arrastra epic/gog/eden, que
// tocan node:fs y rompen el bundle de Metro). En el móvil el botón "Ver mi
// perfil" abre la app de Steam si está instalada, no el navegador, así que
// no hay forma de ver el SteamID64 en una barra de direcciones: aceptar
// también la URL del perfil (o el nombre de usuario) y resolverla aquí es
// lo que hace que copiar el enlace desde la app de Steam sea suficiente.
const STEAM_ID_RE = /^\d{17}$/;

async function resolveSteamId(input, apiKey) {
  const value = String(input || '').trim();
  if (!value) return { error: 'pega tu perfil o tu SteamID64' };
  if (STEAM_ID_RE.test(value)) return { steamId: value };

  const profilesMatch = value.match(/steamcommunity\.com\/profiles\/(\d{17})/);
  if (profilesMatch) return { steamId: profilesMatch[1] };

  const idMatch = value.match(/steamcommunity\.com\/id\/([^/?#]+)/);
  const vanity = idMatch ? decodeURIComponent(idMatch[1]) : value;

  if (!apiKey) {
    return { error: 'necesitas rellenar la Steam API Key (arriba) para resolver un nombre de perfil' };
  }
  try {
    const url = new URL('https://api.steampowered.com/ISteamUser/ResolveVanityURL/v1/');
    url.searchParams.set('key', apiKey);
    url.searchParams.set('vanityurl', vanity);
    const res = await fetch(url);
    if (!res.ok) return { error: `Steam respondió ${res.status} al resolver "${vanity}"` };
    const body = await res.json();
    if (body?.response?.success === 1) return { steamId: body.response.steamid };
    return { error: body?.response?.message || `no se encontró ningún perfil "${vanity}"` };
  } catch (err) {
    return { error: err.message };
  }
}

// authStore para Epic respaldado en /db/settings.js (ver comentario de
// fase 5 arriba) en vez del fichero data/epic_auth.json que usa el
// escritorio.
function epicAuthStore(db) {
  return {
    load() {
      const raw = settingsDb.getSetting(db, 'epicAuth');
      return raw ? JSON.parse(raw) : null;
    },
    save(token) {
      settingsDb.setSetting(
        db,
        'epicAuth',
        JSON.stringify({ refreshToken: token.refreshToken, accountId: token.accountId })
      );
    },
  };
}

// Los mismos 7 temas y los mismos colores exactos que ui/common.js
// (THEMES) + ui/styles.css, para que la paleta se sienta igual que en
// escritorio. RN no tiene custom properties de CSS que redefinir por tema,
// así que cada uno es un objeto plano y el StyleSheet se reconstruye con
// createStyles(colors) cuando cambia (ver `colors`/`styles` en App).
const THEMES = [
  {
    id: 'dark',
    name: 'Glass oscuro',
    colors: {
      bg: '#0a0e1a',
      glass: 'rgba(255,255,255,0.06)',
      stroke: 'rgba(255,255,255,0.12)',
      text: '#e9edf8',
      textMuted: '#97a1bb',
      accent: '#7cc4ff',
      accent2: '#a996ff',
      danger: '#ff8ba0',
    },
  },
  {
    id: 'midnight',
    name: 'Medianoche',
    colors: {
      bg: '#05070d',
      glass: 'rgba(180,210,255,0.06)',
      stroke: 'rgba(180,210,255,0.12)',
      text: '#dbe6f5',
      textMuted: '#7c8aa3',
      accent: '#5ad1ff',
      accent2: '#4f8dff',
      danger: '#ff7d95',
    },
  },
  {
    id: 'aurora',
    name: 'Aurora',
    colors: {
      bg: '#06120f',
      glass: 'rgba(190,255,230,0.06)',
      stroke: 'rgba(190,255,230,0.12)',
      text: '#e6f5ef',
      textMuted: '#86ab9e',
      accent: '#4be3b0',
      accent2: '#38bdf8',
      danger: '#ff8ba0',
    },
  },
  {
    id: 'amber',
    name: 'Ámbar',
    colors: {
      bg: '#170d08',
      glass: 'rgba(255,220,190,0.06)',
      stroke: 'rgba(255,220,190,0.13)',
      text: '#fbe9dc',
      textMuted: '#c39a7d',
      accent: '#ffb454',
      accent2: '#ff7a59',
      danger: '#ff5c6c',
    },
  },
  {
    id: 'light',
    name: 'Claro',
    colors: {
      bg: '#f3f5fb',
      glass: 'rgba(255,255,255,0.55)',
      stroke: 'rgba(28,35,60,0.1)',
      text: '#1c2333',
      textMuted: '#5b6478',
      accent: '#2f7dd1',
      accent2: '#7c5cff',
      danger: '#d43f5a',
    },
  },
  {
    id: 'tavern',
    name: 'Taberna',
    colors: {
      bg: '#1b1108',
      glass: 'rgba(255,205,140,0.06)',
      stroke: 'rgba(255,205,140,0.15)',
      text: '#f2ddbb',
      textMuted: '#ad8862',
      accent: '#e0a458',
      accent2: '#c1440e',
      danger: '#ff6b52',
    },
  },
  {
    id: 'space',
    name: 'Espacio',
    colors: {
      bg: '#050611',
      glass: 'rgba(140,170,255,0.06)',
      stroke: 'rgba(140,170,255,0.14)',
      text: '#e6ecff',
      textMuted: '#7c86b8',
      accent: '#7cf9ff',
      accent2: '#b06bff',
      danger: '#ff5c8a',
    },
  },
];
const DEFAULT_THEME_ID = 'dark';

function paletteFor(themeId) {
  return (THEMES.find((t) => t.id === themeId) || THEMES[0]).colors;
}

function formatHours(minutes) {
  return `${(minutes / 60).toFixed(1)} h`;
}

// Igual que ui/common.js -> formatDate, pero sin depender de Intl/locale
// (con Hermes no siempre está garantizado el paquete de datos de es-ES).
function formatDate(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const PRECISION_LABELS = { exact: 'hora exacta', approximate: 'aproximada', derived: 'derivada de Steam' };

function sessionSortKey(session) {
  return session.endedAt || session.startedAt || session.createdAt;
}

function sessionLabel(session) {
  if (session.startedAt && session.endedAt) {
    return `${formatDate(session.startedAt)} → ${formatDate(session.endedAt)}`;
  }
  if (!session.startedAt && session.endedAt) {
    return `hasta ${formatDate(session.endedAt)} (antes de empezar a sincronizar)`;
  }
  return `registrada el ${formatDate(session.createdAt)}`;
}

// Mismas dos listas que ui/app.js (TAB_FILTERS / ROULETTE_MODES): "Lista de
// siguientes" y "Jugando ahora" son independientes de "Mis juegos".
const TAB_FILTERS = {
  toplay: (g) => g.inToPlay,
  playing: (g) => g.inPlayingNow,
};
const TAB_EMPTY_MESSAGES = {
  all: 'Todavía no hay juegos. Añade uno arriba o sincroniza con Steam.',
  toplay: 'Tu lista está vacía. Marca juegos con ▶ desde «Mis juegos».',
  playing: 'No estás jugando nada ahora mismo. Marca juegos con 🎮 desde «Mis juegos».',
};
const ROULETTE_MODES = {
  toplay: { title: '¿A qué juego jugamos?', filter: (g) => g.inToPlay, resultPrefix: 'Te toca jugar a' },
  playing: { title: '¿Con cuál seguimos hoy?', filter: (g) => g.inPlayingNow, resultPrefix: 'Hoy le toca a' },
};

const SETTINGS_TABS = [
  { id: 'accounts', label: 'Cuentas' },
  { id: 'appearance', label: 'Apariencia' },
];

// Botón junto a cada campo de credencial: abre en el navegador la página
// exacta de donde se saca ese valor, para que rellenar Ajustes no dependa
// de saber ya dónde buscar (mismo espíritu que `setup/open-url.js` en
// escritorio, pero como botón en vez de paso automático de un wizard).
// `styles` llega por prop porque ya no es un StyleSheet fijo a nivel de
// módulo: depende del tema activo (ver createStyles en App).
function GetItButton({ label, url, styles }) {
  return (
    <Pressable style={styles.getItButton} onPress={() => openHelpUrl(url)}>
      <Text style={styles.getItButtonText}>{label} ↗</Text>
    </Pressable>
  );
}

// Equivalente móvil de la ruleta de ui/app.js: en vez de un disco SVG que
// gira (habría que sumar react-native-svg solo para esto, en contra de "sin
// dependencias innecesarias"), un marcador de nombres que va pasando cada
// vez más despacio hasta pararse en el elegido — mismo efecto de suspense,
// sin dependencias nuevas. El pulso de escala en cada nombre sustituye al
// "tock" de audio del escritorio (Web Audio tampoco existe en RN sin sumar
// expo-av).
function RouletteModal({ visible, mode, games, onClose, onOpenGame, colors, styles }) {
  const [spinning, setSpinning] = useState(false);
  const [displayTitle, setDisplayTitle] = useState('');
  const [result, setResult] = useState(null);
  const pulse = useRef(new Animated.Value(1)).current;
  const timerRef = useRef(null);

  useEffect(() => {
    if (!visible) {
      clearTimeout(timerRef.current);
      setSpinning(false);
      setResult(null);
      setDisplayTitle('');
    }
    return () => clearTimeout(timerRef.current);
  }, [visible]);

  function bump() {
    pulse.setValue(0.92);
    Animated.spring(pulse, { toValue: 1, useNativeDriver: true, friction: 4, tension: 120 }).start();
  }

  function spin() {
    if (spinning || games.length === 0) return;
    setSpinning(true);
    setResult(null);

    const finalIndex = Math.floor(Math.random() * games.length);
    const laps = games.length * 2 + Math.floor(Math.random() * games.length) + 6;
    let step = 0;

    const tick = () => {
      const idx = step % games.length;
      setDisplayTitle(games[idx].title);
      bump();
      step += 1;
      if (step >= laps) {
        setSpinning(false);
        setResult(games[finalIndex]);
        return;
      }
      // se va frenando: empieza casi instantáneo y termina con pausas largas.
      const progress = step / laps;
      const delay = 45 + progress * progress * 300;
      timerRef.current = setTimeout(tick, delay);
    };
    tick();
  }

  if (!mode) return null;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalBox}>
          <Pressable style={styles.modalCloseBtn} onPress={onClose}>
            <Text style={styles.modalCloseBtnText}>×</Text>
          </Pressable>
          <Text style={styles.title}>{mode.title}</Text>

          <View style={styles.wheelBox}>
            {result ? (
              <Text style={styles.wheelResult}>
                {mode.resultPrefix} <Text style={styles.wheelResultName}>{result.title}</Text>
              </Text>
            ) : (
              <Animated.Text
                style={[styles.wheelSpinningName, { transform: [{ scale: pulse }] }]}
                numberOfLines={2}
              >
                {displayTitle || (games.length ? 'Gira la ruleta…' : 'No hay juegos en esta lista.')}
              </Animated.Text>
            )}
          </View>

          <View style={styles.settingsButtons}>
            <Pressable
              style={[styles.addButton, (spinning || games.length === 0) && styles.buttonDisabled]}
              onPress={spin}
              disabled={spinning || games.length === 0}
            >
              {spinning ? (
                <ActivityIndicator color={colors.bg} />
              ) : (
                <Text style={styles.addButtonText}>{result ? 'Girar otra vez' : 'Girar'}</Text>
              )}
            </Pressable>
            {result && (
              <Pressable
                style={styles.secondaryButton}
                onPress={() => {
                  onOpenGame(result.id);
                  onClose();
                }}
              >
                <Text style={styles.secondaryButtonText}>Abrir ficha →</Text>
              </Pressable>
            )}
          </View>
        </View>
      </View>
    </Modal>
  );
}

export default function App() {
  const [db, setDb] = useState(null);
  const [view, setView] = useState('library');
  const [games, setGames] = useState([]);
  const [error, setError] = useState(null);
  const [title, setTitle] = useState('');
  const [saving, setSaving] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [xboxSyncing, setXboxSyncing] = useState(false);
  const [epicSyncing, setEpicSyncing] = useState(false);
  const [connectingEpic, setConnectingEpic] = useState(false);
  const [lastSync, setLastSync] = useState(null);
  const [lastXboxSync, setLastXboxSync] = useState(null);
  const [lastEpicSync, setLastEpicSync] = useState(null);
  const [apiKey, setApiKey] = useState('');
  const [steamId, setSteamId] = useState('');
  const [xboxApiKey, setXboxApiKey] = useState('');
  const [epicCode, setEpicCode] = useState('');
  const [epicAccountId, setEpicAccountId] = useState(null);

  // Fase 6: pestañas "Mis juegos" / "Lista de siguientes" / "Jugando ahora"
  // (mismas listas que ui/app.js), ficha de cada juego (sesiones + logros) y
  // ruleta. `selectedGameId` guarda con qué juego se abrió la ficha para
  // poder recargar sus datos tras añadir una sesión.
  const [currentTab, setCurrentTab] = useState('all');
  const [selectedGameId, setSelectedGameId] = useState(null);
  const [gameSessions, setGameSessions] = useState([]);
  const [gameAchievements, setGameAchievements] = useState([]);
  const [sessionHours, setSessionHours] = useState('');
  const [sessionNote, setSessionNote] = useState('');
  const [savingSession, setSavingSession] = useState(false);
  const [rouletteOpen, setRouletteOpen] = useState(false);

  // Fase 7: pestañas de Ajustes ("Cuentas" / "Apariencia") y tema elegido,
  // guardado igual que el resto de settings (tabla settings, clave 'theme').
  const [settingsTab, setSettingsTab] = useState('accounts');
  const [themeId, setThemeId] = useState(DEFAULT_THEME_ID);

  const colors = useMemo(() => paletteFor(themeId), [themeId]);
  const styles = useMemo(() => createStyles(colors), [colors]);
  const statusBarStyle = themeId === 'light' ? 'dark-content' : 'light-content';

  // Android hace hueco para el teclado (windowSoftInputMode="resize", el
  // valor por defecto de Expo) pero no desplaza el contenido hasta el campo
  // que estás rellenando, así que si está más abajo del hueco visible el
  // teclado lo tapa igual. Guardamos la posición Y de cada campo al montar
  // (onLayout) y, cuando el teclado termina de aparecer, desplazamos hasta
  // ahí. `keyboardDidShow` (no onFocus a secas) es necesario porque si se
  // dispara antes de que el teclado haya hecho hueco el scroll cae corto.
  //
  // `scrollRef` apunta al ScrollView de Ajustes o al FlatList de la
  // biblioteca según cuál esté montado (solo hay una vista activa a la
  // vez): tienen APIs de scroll distintas (`scrollTo` vs `scrollToOffset`),
  // así que `scrollActiveTo` prueba ambas en vez de asumir cuál es.
  const scrollRef = useRef(null);
  const fieldOffsets = useRef({});
  const focusedField = useRef(null);

  function rememberFieldY(key) {
    return (e) => {
      fieldOffsets.current[key] = e.nativeEvent.layout.y;
    };
  }

  function scrollActiveTo(y) {
    const target = Math.max(y - 16, 0);
    const ref = scrollRef.current;
    if (!ref) return;
    if (typeof ref.scrollToOffset === 'function') ref.scrollToOffset({ offset: target, animated: true });
    else if (typeof ref.scrollTo === 'function') ref.scrollTo({ y: target, animated: true });
  }

  function scrollToField(key) {
    focusedField.current = key;
    const y = fieldOffsets.current[key];
    if (y != null) scrollActiveTo(y);
  }

  useEffect(() => {
    const sub = Keyboard.addListener('keyboardDidShow', () => {
      const y = fieldOffsets.current[focusedField.current];
      if (y != null) scrollActiveTo(y);
    });
    return () => sub.remove();
  }, []);

  // El botón/gesto atrás de Android por defecto cierra la app entera (React
  // Native no sabe nada de nuestra navegación manual por `view`). Desde la
  // ficha de un juego o desde Ajustes, en vez de eso vuelve a la biblioteca
  // (en la pestaña en la que estabas, porque `currentTab` no se toca) —
  // igual que el botón "← Volver". En la propia biblioteca se deja el
  // comportamiento por defecto (salir).
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (view === 'game') {
        setView('library');
        setSelectedGameId(null);
        setGameSessions([]);
        setGameAchievements([]);
        return true;
      }
      if (view === 'settings') {
        setView('library');
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [view]);

  useEffect(() => {
    try {
      const database = openDatabase();
      migrate(database);
      const savedApiKey = settingsDb.getSetting(database, 'steamApiKey') || '';
      const savedSteamId = settingsDb.getSetting(database, 'steamId') || '';
      setApiKey(savedApiKey);
      setSteamId(savedSteamId);
      setXboxApiKey(settingsDb.getSetting(database, 'openxblApiKey') || '');
      setEpicAccountId(epicAuthStore(database).load()?.accountId || null);
      const savedTheme = settingsDb.getSetting(database, 'theme');
      if (savedTheme) setThemeId(savedTheme);
      setDb(database);
      // Primer arranque (todavía sin Steam configurado): ir directo a
      // Ajustes en vez de a una biblioteca vacía, para que lo primero que
      // vea quien instala la app sean los botones para conseguir sus claves.
      if (!savedApiKey || !savedSteamId) setView('settings');
    } catch (err) {
      setError(err.message);
    }
  }, []);

  const reload = useCallback(
    (database) => {
      const target = database || db;
      if (!target) return;
      try {
        setGames(groupGames(gamesDb.listGames(target)));
      } catch (err) {
        setError(err.message);
      }
    },
    [db]
  );

  useEffect(() => {
    if (db) reload(db);
  }, [db, reload]);

  if (bootError) {
    return (
      <View style={[styles.container, { paddingTop: 80 }]}>
        <StatusBar barStyle={statusBarStyle} backgroundColor={colors.bg} />
        <Text style={styles.title}>Error al iniciar la app</Text>
        <Text style={styles.error}>{String(bootError.stack || bootError.message || bootError)}</Text>
      </View>
    );
  }

  function selectTheme(id) {
    setThemeId(id);
    if (db) settingsDb.setSetting(db, 'theme', id);
  }

  async function onAdd() {
    if (!db || !title.trim()) return;
    setSaving(true);
    try {
      const clean = validateManualGame({ title, platform: 'Manual' });
      gamesDb.insertManualGame(db, clean);
      setTitle('');
      reload(db);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function onSaveSettings() {
    if (!db || savingSettings) return;
    setError(null);
    const trimmedSteamId = steamId.trim();
    let resolvedSteamId = trimmedSteamId;
    if (trimmedSteamId && !STEAM_ID_RE.test(trimmedSteamId)) {
      setSavingSettings(true);
      const { steamId: resolved, error: resolveError } = await resolveSteamId(trimmedSteamId, apiKey.trim());
      setSavingSettings(false);
      if (resolveError) {
        setError(`SteamID: ${resolveError}`);
        return;
      }
      resolvedSteamId = resolved;
      setSteamId(resolvedSteamId);
    }
    settingsDb.setSetting(db, 'steamApiKey', apiKey.trim());
    settingsDb.setSetting(db, 'steamId', resolvedSteamId);
    settingsDb.setSetting(db, 'openxblApiKey', xboxApiKey.trim());
    setView('library');
  }

  async function onSync() {
    if (!db || syncing) return;
    const key = settingsDb.getSetting(db, 'steamApiKey');
    const id = settingsDb.getSetting(db, 'steamId');
    if (!key || !id) {
      setError('Configura tu Steam API Key y SteamID en Ajustes antes de sincronizar.');
      setView('settings');
      return;
    }
    setSyncing(true);
    setError(null);
    try {
      const { gamesSynced } = await runSync({ db, apiKey: key, steamId: id });
      setLastSync(`${gamesSynced} juegos · ${new Date().toLocaleTimeString()}`);
      reload(db);
    } catch (err) {
      setError(`Fallo la sincronización: ${err.message}`);
    } finally {
      setSyncing(false);
    }
  }

  async function onConnectEpic() {
    if (!db || !epicCode.trim() || connectingEpic) return;
    setConnectingEpic(true);
    setError(null);
    try {
      const code = extractEpicCode(epicCode);
      const accountId = await loginWithCode(code, { authStore: epicAuthStore(db) });
      setEpicAccountId(accountId);
      setEpicCode('');
    } catch (err) {
      setError(`No se pudo conectar con Epic: ${err.message}`);
    } finally {
      setConnectingEpic(false);
    }
  }

  async function onEpicSync() {
    if (!db || epicSyncing) return;
    if (!epicAuthStore(db).load()?.refreshToken) {
      setError('Conecta tu cuenta de Epic en Ajustes antes de sincronizar.');
      setView('settings');
      return;
    }
    setEpicSyncing(true);
    setError(null);
    try {
      const result = await runEpicSync({ db, authStore: epicAuthStore(db) });
      setLastEpicSync(`${result.added + result.updated} juegos · ${new Date().toLocaleTimeString()}`);
      reload(db);
    } catch (err) {
      setError(`Fallo la sincronización de Epic: ${err.message}`);
    } finally {
      setEpicSyncing(false);
    }
  }

  async function onXboxSync() {
    if (!db || xboxSyncing) return;
    const key = settingsDb.getSetting(db, 'openxblApiKey');
    if (!key) {
      setError('Configura tu OpenXBL API Key en Ajustes antes de sincronizar con Xbox.');
      setView('settings');
      return;
    }
    setXboxSyncing(true);
    setError(null);
    try {
      const result = await runXboxSync({ db, apiKey: key });
      const suffix = result.stoppedEarly
        ? ` (límite de OpenXBL alcanzado, quedan ${result.pending} por revisar)`
        : '';
      setLastXboxSync(`${result.gamesSynced} juegos · ${new Date().toLocaleTimeString()}${suffix}`);
      reload(db);
    } catch (err) {
      setError(`Fallo la sincronización de Xbox: ${err.message}`);
    } finally {
      setXboxSyncing(false);
    }
  }

  // --- pestañas "Lista de siguientes" / "Jugando ahora" ---
  // El estado de pertenencia se lee del propio `games` ya cargado (en vez de
  // volver a consultar to_play_list/playing_now) porque es lo que ya está en
  // pantalla y evita una vuelta extra a SQLite por cada toque.
  function toggleToPlay(gameId) {
    if (!db) return;
    const game = games.find((g) => g.id === gameId);
    try {
      if (game?.inToPlay) toPlayDb.remove(db, gameId);
      else toPlayDb.add(db, gameId);
      reload(db);
    } catch (err) {
      setError(err.message);
    }
  }

  function togglePlayingNow(gameId) {
    if (!db) return;
    const game = games.find((g) => g.id === gameId);
    try {
      if (game?.inPlayingNow) playingNowDb.remove(db, gameId);
      else playingNowDb.add(db, gameId);
      reload(db);
    } catch (err) {
      setError(err.message);
    }
  }

  function removeFromTab(gameId) {
    if (!db) return;
    try {
      if (currentTab === 'toplay') toPlayDb.remove(db, gameId);
      else if (currentTab === 'playing') playingNowDb.remove(db, gameId);
      reload(db);
    } catch (err) {
      setError(err.message);
    }
  }

  // --- ficha de un juego: sesiones + logros ---
  function loadGameDetail(gameId) {
    if (!db) return;
    try {
      setGameSessions(sessionsDb.listSessionsForGame(db, gameId));
      setGameAchievements(achievementsDb.listAchievementsForGame(db, gameId));
    } catch (err) {
      setError(err.message);
    }
  }

  function openGame(gameId) {
    setSelectedGameId(gameId);
    setSessionHours('');
    setSessionNote('');
    loadGameDetail(gameId);
    setView('game');
  }

  function closeGame() {
    setView('library');
    setSelectedGameId(null);
    setGameSessions([]);
    setGameAchievements([]);
  }

  async function onAddSession() {
    if (!db || !selectedGameId || savingSession) return;
    setSavingSession(true);
    setError(null);
    try {
      const hours = Number(sessionHours.replace(',', '.'));
      if (!Number.isFinite(hours) || hours <= 0) throw new Error('Indica cuántas horas has jugado.');
      const draft = buildManualSession({ minutes: Math.round(hours * 60), note: sessionNote });
      sessionsDb.insertSession(db, selectedGameId, draft);
      setSessionHours('');
      setSessionNote('');
      loadGameDetail(selectedGameId);
      reload(db);
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingSession(false);
    }
  }

  const selectedGame = selectedGameId ? games.find((g) => g.id === selectedGameId) || null : null;
  const activeRouletteMode = ROULETTE_MODES[currentTab] || null;
  const rouletteGames = activeRouletteMode ? games.filter(activeRouletteMode.filter) : [];

  if (view === 'game') {
    if (!selectedGame) {
      return (
        <View style={[styles.container, { paddingTop: 56 }]}>
          <StatusBar barStyle={statusBarStyle} backgroundColor={colors.bg} />
          <Pressable onPress={closeGame}>
            <Text style={styles.backLink}>← Volver</Text>
          </Pressable>
          <Text style={styles.empty}>Este juego ya no está en tu biblioteca.</Text>
        </View>
      );
    }

    const sortedSessions = [...gameSessions].sort((a, b) =>
      (sessionSortKey(b) || '').localeCompare(sessionSortKey(a) || '')
    );

    return (
      <KeyboardAvoidingView style={styles.flexBg} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <StatusBar barStyle={statusBarStyle} backgroundColor={colors.bg} />
        <ScrollView contentContainerStyle={styles.settingsContent} keyboardShouldPersistTaps="handled">
          <Pressable onPress={closeGame}>
            <Text style={styles.backLink}>← Volver a la biblioteca</Text>
          </Pressable>

          <View style={styles.gameHeaderRow}>
            {selectedGame.iconUrl ? (
              <Image source={{ uri: selectedGame.iconUrl }} style={styles.gameHeaderIcon} />
            ) : (
              <View style={[styles.gameHeaderIcon, styles.cardIconPlaceholder]} />
            )}
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>{selectedGame.title}</Text>
              <Text style={styles.cardPlatform}>{selectedGame.platforms.join(' · ')}</Text>
              {selectedGame.missingSince && <Text style={styles.error}>ya no está en Steam</Text>}
            </View>
          </View>

          <View style={styles.statsRow}>
            <Text style={styles.statBig}>{formatHours(selectedGame.totalMinutes)} jugadas en total</Text>
            {selectedGame.achievementsTotal > 0 && (
              <Text style={styles.statBig}>
                🏆 {selectedGame.achievementsUnlocked}/{selectedGame.achievementsTotal} logros
              </Text>
            )}
            {selectedGame.igdbMainMinutes ? (
              <Text style={styles.statBig}>▶ {formatHours(selectedGame.igdbMainMinutes)} historia principal</Text>
            ) : null}
          </View>

          <Text style={styles.sectionLabel}>Registrar sesión</Text>
          <View style={styles.addRow}>
            <TextInput
              style={[styles.input, { flex: 0, width: 90 }]}
              placeholder="Horas"
              placeholderTextColor={colors.textMuted}
              value={sessionHours}
              onChangeText={setSessionHours}
              keyboardType="decimal-pad"
            />
            <TextInput
              style={styles.input}
              placeholder="Nota (opcional)"
              placeholderTextColor={colors.textMuted}
              value={sessionNote}
              onChangeText={setSessionNote}
            />
            <Pressable style={styles.addButton} onPress={onAddSession} disabled={savingSession}>
              {savingSession ? (
                <ActivityIndicator color={colors.bg} />
              ) : (
                <Text style={styles.addButtonText}>Añadir</Text>
              )}
            </Pressable>
          </View>

          <Text style={styles.sectionLabel}>Sesiones</Text>
          {sortedSessions.length === 0 ? (
            <Text style={styles.empty}>Todavía no hay sesiones registradas.</Text>
          ) : (
            sortedSessions.map((session) => (
              <View key={session.id} style={styles.sessionRow}>
                <Text style={styles.sessionMinutes}>{formatHours(session.minutes)}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.sessionWhen}>{sessionLabel(session)}</Text>
                  <Text style={styles.sessionMeta}>
                    {PRECISION_LABELS[session.precision] || session.precision}
                    {session.note ? ` · ${session.note}` : ''}
                  </Text>
                </View>
              </View>
            ))
          )}

          <Text style={styles.sectionLabel}>Logros</Text>
          {gameAchievements.length === 0 ? (
            <Text style={styles.empty}>Este juego no tiene logros en Steam (o todavía no se han sincronizado).</Text>
          ) : (
            gameAchievements.map((achievement) => (
              <View key={achievement.id} style={styles.achievementRow}>
                <Text style={styles.achievementIcon}>{achievement.achieved ? '🏆' : '🔒'}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.achievementName, !achievement.achieved && styles.textMuted]}>
                    {achievement.name || achievement.apiName}
                  </Text>
                  {achievement.description ? (
                    <Text style={styles.achievementDesc}>{achievement.description}</Text>
                  ) : null}
                </View>
                {achievement.achieved && (
                  <Text style={styles.achievementDate}>{formatDate(achievement.unlockedAt)}</Text>
                )}
              </View>
            ))
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  if (view === 'settings') {
    const firstRun = !apiKey || !steamId;
    return (
      <KeyboardAvoidingView
        style={styles.flexBg}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <StatusBar barStyle={statusBarStyle} backgroundColor={colors.bg} />
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={styles.settingsContent}
          keyboardShouldPersistTaps="handled"
        >
        <Text style={styles.kicker}>AJUSTES</Text>
        <Text style={styles.title}>{settingsTab === 'accounts' ? 'Cuentas' : 'Apariencia'}</Text>

        <View style={styles.tabsRow}>
          {SETTINGS_TABS.map((tab) => (
            <Pressable
              key={tab.id}
              style={[styles.tabButton, settingsTab === tab.id && styles.tabButtonActive]}
              onPress={() => setSettingsTab(tab.id)}
            >
              <Text style={[styles.tabButtonText, settingsTab === tab.id && styles.tabButtonTextActive]}>
                {tab.label}
              </Text>
            </Pressable>
          ))}
        </View>

        {error && <Text style={styles.error}>{error}</Text>}

        {settingsTab === 'appearance' ? (
          <>
            <Text style={styles.sectionLabel}>Paleta</Text>
            <View style={styles.themeGrid}>
              {THEMES.map((t) => {
                const active = t.id === themeId;
                return (
                  <Pressable
                    key={t.id}
                    style={[styles.themeCard, active && styles.themeCardActive]}
                    onPress={() => selectTheme(t.id)}
                  >
                    <View style={[styles.themeSwatch, { backgroundColor: t.colors.bg, borderColor: t.colors.stroke }]}>
                      <View style={[styles.themeSwatchDot, { backgroundColor: t.colors.accent }]} />
                      <View style={[styles.themeSwatchDot, { backgroundColor: t.colors.accent2 }]} />
                      {active && <Text style={[styles.themeCheck, { color: t.colors.accent }]}>✓</Text>}
                    </View>
                    <Text style={styles.themeName}>{t.name}</Text>
                  </Pressable>
                );
              })}
            </View>

            <View style={styles.settingsButtons}>
              <Pressable style={styles.secondaryButton} onPress={() => setView('library')}>
                <Text style={styles.secondaryButtonText}>Volver</Text>
              </Pressable>
            </View>
          </>
        ) : (
          <>
            {firstRun && (
              <Text style={styles.intro}>
                Para sincronizar hace falta al menos Steam. Pulsa el botón junto a cada campo:
                te lleva a la página exacta donde se consigue, cópialo y pégalo aquí. Xbox y
                Epic son opcionales — si no te interesan, déjalos en blanco y pulsa «Saltar
                por ahora» o «Guardar» tal cual.
              </Text>
            )}

            <Text style={styles.sectionLabel}>Steam</Text>
            <View style={styles.labelRow}>
              <Text style={styles.label}>Steam API Key</Text>
              <GetItButton styles={styles} label="Conseguir clave" url={HELP_URLS.steamApiKey} />
            </View>
            <TextInput
              style={styles.inputMultiline}
              placeholder="Pega aquí la clave"
              placeholderTextColor={colors.textMuted}
              value={apiKey}
              onChangeText={setApiKey}
              autoCapitalize="none"
              autoCorrect={false}
              multiline
              textAlignVertical="top"
              onFocus={() => scrollToField('apiKey')}
              onLayout={rememberFieldY('apiKey')}
            />

            <View style={styles.labelRow}>
              <Text style={styles.label}>SteamID64</Text>
              <GetItButton styles={styles} label="Ver mi perfil" url={HELP_URLS.steamProfile} />
            </View>
            <Text style={styles.hint}>
              El botón de arriba suele abrir la app de Steam en vez del navegador, y ahí no se
              ve ningún número. En la app, pulsa el icono de compartir de tu perfil (⋯ → Compartir
              perfil → Copiar enlace) y pega ese enlace aquí abajo — la app saca el SteamID64 sola.
              También vale pegar directamente el número de 17 dígitos si ya lo tienes.
            </Text>
            <TextInput
              style={styles.inputMultiline}
              placeholder="Enlace de tu perfil o tu SteamID64"
              placeholderTextColor={colors.textMuted}
              value={steamId}
              onChangeText={setSteamId}
              autoCapitalize="none"
              autoCorrect={false}
              multiline
              textAlignVertical="top"
              onFocus={() => scrollToField('steamId')}
              onLayout={rememberFieldY('steamId')}
            />

            <Text style={styles.sectionLabel}>Xbox (opcional)</Text>
            <View style={styles.labelRow}>
              <Text style={styles.label}>OpenXBL API Key</Text>
              <GetItButton styles={styles} label="Conseguir clave" url={HELP_URLS.openxbl} />
            </View>
            <TextInput
              style={styles.inputMultiline}
              placeholder="Pega aquí la clave"
              placeholderTextColor={colors.textMuted}
              value={xboxApiKey}
              onChangeText={setXboxApiKey}
              autoCapitalize="none"
              autoCorrect={false}
              multiline
              textAlignVertical="top"
              onFocus={() => scrollToField('xboxApiKey')}
              onLayout={rememberFieldY('xboxApiKey')}
            />

            <Text style={styles.sectionLabel}>Epic Games (opcional)</Text>
            <View style={styles.labelRow}>
              <Text style={styles.label}>
                {epicAccountId ? `Conectado (cuenta ${epicAccountId}).` : 'Código de un solo uso'}
              </Text>
              <GetItButton styles={styles} label="Abrir página de Epic" url={HELP_URLS.epic} />
            </View>
            {!epicAccountId && (
              <Text style={styles.hint}>
                Con sesión abierta en epicgames.com, pulsa el botón de arriba: te lleva a una
                página en blanco con solo un bloque de texto — no hace falta que entiendas lo
                que pone. Mantén el dedo pulsado sobre ese texto, elige «Seleccionar todo»,
                cópialo entero (todo el bloque, no hace falta buscar nada dentro) y pégalo tal
                cual en el campo de abajo: la app saca el código sola.
              </Text>
            )}
            <View style={styles.addRowMultiline}>
              <TextInput
                style={styles.inputMultiline}
                placeholder="Pega aquí todo el texto de la página"
                placeholderTextColor={colors.textMuted}
                value={epicCode}
                onChangeText={setEpicCode}
                autoCapitalize="none"
                autoCorrect={false}
                multiline
                textAlignVertical="top"
                onFocus={() => scrollToField('epicCode')}
                onLayout={rememberFieldY('epicCode')}
              />
              <Pressable
                style={[styles.addButton, styles.addButtonEnd]}
                onPress={onConnectEpic}
                disabled={connectingEpic}
              >
                {connectingEpic ? (
                  <ActivityIndicator color={colors.bg} />
                ) : (
                  <Text style={styles.addButtonText}>{epicAccountId ? 'Reconectar' : 'Conectar'}</Text>
                )}
              </Pressable>
            </View>

            <View style={styles.settingsButtons}>
              <Pressable style={styles.secondaryButton} onPress={() => setView('library')}>
                <Text style={styles.secondaryButtonText}>{firstRun ? 'Saltar por ahora' : 'Cancelar'}</Text>
              </Pressable>
              <Pressable style={styles.addButton} onPress={onSaveSettings} disabled={savingSettings}>
                {savingSettings ? (
                  <ActivityIndicator color={colors.bg} />
                ) : (
                  <Text style={styles.addButtonText}>Guardar</Text>
                )}
              </Pressable>
            </View>
          </>
        )}
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  // La biblioteca vive entera dentro de un único FlatList (cabecera +
  // tarjetas), en vez de un View fijo con el FlatList encajado dentro:
  // así, cuando el teclado se abre y Android encoge la ventana
  // (windowSoftInputMode="resize"), lo que se encoge es el contenido
  // scrolleable completo en vez de solo la lista de juegos — si esta
  // quedaba con una altura casi nula (o cero) no había nada scrolleable
  // que permitiera ver el resto de la pantalla. `scrollToField('title')`
  // reutiliza el mismo mecanismo de Ajustes para que el campo de añadir
  // juego se lleve a la vista cuando aparece el teclado.
  return (
    <KeyboardAvoidingView
      style={styles.flexBg}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <StatusBar barStyle={statusBarStyle} backgroundColor={colors.bg} />
      <FlatList
        ref={scrollRef}
        style={styles.flexBg}
        contentContainerStyle={styles.listContent}
        keyboardShouldPersistTaps="handled"
        data={db ? games.filter(TAB_FILTERS[currentTab] || (() => true)) : []}
        keyExtractor={(g) => String(g.id)}
        ListHeaderComponent={
          <View>
            <View style={styles.headerRow}>
              <View>
                <Text style={styles.kicker}>BACKLOG</Text>
                <Text style={styles.title}>Mi biblioteca</Text>
              </View>
              <Pressable style={styles.gearButton} onPress={() => setView('settings')}>
                <Text style={styles.gearButtonText}>⚙</Text>
              </Pressable>
            </View>

            {error && <Text style={styles.error}>{error}</Text>}

            <View style={styles.tabsRow}>
              {[
                { id: 'all', label: 'Mis juegos' },
                { id: 'toplay', label: `Siguientes (${games.filter((g) => g.inToPlay).length})` },
                { id: 'playing', label: `Jugando (${games.filter((g) => g.inPlayingNow).length})` },
              ].map((tab) => (
                <Pressable
                  key={tab.id}
                  style={[styles.tabButton, currentTab === tab.id && styles.tabButtonActive]}
                  onPress={() => setCurrentTab(tab.id)}
                >
                  <Text style={[styles.tabButtonText, currentTab === tab.id && styles.tabButtonTextActive]}>
                    {tab.label}
                  </Text>
                </Pressable>
              ))}
            </View>

            {activeRouletteMode && (
              <Pressable
                style={[styles.rouletteButton, rouletteGames.length === 0 && styles.buttonDisabled]}
                onPress={() => rouletteGames.length > 0 && setRouletteOpen(true)}
                disabled={rouletteGames.length === 0}
              >
                <Text style={styles.addButtonText}>◉ Ruleta</Text>
              </Pressable>
            )}

            <Pressable style={styles.syncButton} onPress={onSync} disabled={syncing}>
              {syncing ? (
                <ActivityIndicator color={colors.bg} />
              ) : (
                <Text style={styles.addButtonText}>Sincronizar con Steam</Text>
              )}
            </Pressable>
            {lastSync && <Text style={styles.syncInfo}>Última sincronización: {lastSync}</Text>}

            <Pressable style={styles.syncButton} onPress={onXboxSync} disabled={xboxSyncing}>
              {xboxSyncing ? (
                <ActivityIndicator color={colors.bg} />
              ) : (
                <Text style={styles.addButtonText}>Sincronizar con Xbox</Text>
              )}
            </Pressable>
            {lastXboxSync && <Text style={styles.syncInfo}>Última sincronización: {lastXboxSync}</Text>}

            <Pressable style={styles.syncButton} onPress={onEpicSync} disabled={epicSyncing}>
              {epicSyncing ? (
                <ActivityIndicator color={colors.bg} />
              ) : (
                <Text style={styles.addButtonText}>Sincronizar con Epic</Text>
              )}
            </Pressable>
            {lastEpicSync && <Text style={styles.syncInfo}>Última sincronización: {lastEpicSync}</Text>}

            <View style={styles.addRow} onLayout={rememberFieldY('title')}>
              <TextInput
                style={styles.input}
                placeholder="Título del juego"
                placeholderTextColor={colors.textMuted}
                value={title}
                onChangeText={setTitle}
                onFocus={() => scrollToField('title')}
              />
              <Pressable style={styles.addButton} onPress={onAdd} disabled={saving}>
                {saving ? <ActivityIndicator color={colors.bg} /> : <Text style={styles.addButtonText}>Añadir</Text>}
              </Pressable>
            </View>
          </View>
        }
        ListEmptyComponent={
          !db ? (
            <ActivityIndicator color={colors.accent} style={{ marginTop: 24 }} />
          ) : (
            <Text style={styles.empty}>{TAB_EMPTY_MESSAGES[currentTab]}</Text>
          )
        }
        renderItem={({ item }) => (
          <Pressable style={styles.card} onPress={() => openGame(item.id)}>
            {item.iconUrl ? (
              <Image source={{ uri: item.iconUrl }} style={styles.cardIcon} />
            ) : (
              <View style={[styles.cardIcon, styles.cardIconPlaceholder]} />
            )}
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle}>{item.title}</Text>
              <Text style={styles.cardPlatform}>{item.platforms.join(' · ')}</Text>
              <View style={styles.cardFlags}>
                {item.achievementsTotal > 0 && (
                  <Text style={styles.cardAchievements}>
                    🏆 {item.achievementsUnlocked}/{item.achievementsTotal}
                  </Text>
                )}
                {item.inToPlay && currentTab !== 'toplay' && <Text style={styles.cardFlag}>▶ siguiente</Text>}
                {item.inPlayingNow && currentTab !== 'playing' && (
                  <Text style={styles.cardFlag}>🎮 jugando</Text>
                )}
              </View>
            </View>
            <View style={styles.cardRight}>
              <Text style={styles.cardHours}>{formatHours(item.totalMinutes)}</Text>
              {currentTab === 'all' ? (
                <View style={styles.cardActions}>
                  <Pressable
                    style={[styles.cardActionBtn, item.inToPlay && styles.cardActionBtnActive]}
                    onPress={(e) => {
                      e.stopPropagation();
                      toggleToPlay(item.id);
                    }}
                  >
                    <Text style={styles.cardActionBtnText}>▶</Text>
                  </Pressable>
                  <Pressable
                    style={[styles.cardActionBtn, item.inPlayingNow && styles.cardActionBtnActive]}
                    onPress={(e) => {
                      e.stopPropagation();
                      togglePlayingNow(item.id);
                    }}
                  >
                    <Text style={styles.cardActionBtnText}>🎮</Text>
                  </Pressable>
                </View>
              ) : (
                <Pressable
                  style={styles.cardActionBtn}
                  onPress={(e) => {
                    e.stopPropagation();
                    removeFromTab(item.id);
                  }}
                >
                  <Text style={styles.cardActionBtnText}>×</Text>
                </Pressable>
              )}
            </View>
          </Pressable>
        )}
      />
      <RouletteModal
        visible={rouletteOpen}
        mode={activeRouletteMode}
        games={rouletteGames}
        onClose={() => setRouletteOpen(false)}
        onOpenGame={openGame}
        colors={colors}
        styles={styles}
      />
    </KeyboardAvoidingView>
  );
}

// El StyleSheet ya no es un objeto fijo a nivel de módulo: depende del
// tema activo, así que se reconstruye (memoizado con useMemo en App) cada
// vez que `colors` cambia. StyleSheet.create() sigue siendo seguro llamarlo
// más de una vez — solo registra estilos, no hay coste de "recrear una
// hoja de estilos global".
function createStyles(colors) {
  return StyleSheet.create({
  flexBg: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  container: {
    flex: 1,
    backgroundColor: colors.bg,
    paddingTop: 56,
    paddingHorizontal: 20,
  },
  // Para el `contentContainerStyle` de un ScrollView hace falta `flexGrow`,
  // no `flex`: con `flex: 1` el contenido se queda encajado a la altura
  // visible de la pantalla y todo lo que no cabe (el botón «Guardar» del
  // final, sobre todo si hay campos con texto largo pegado) queda fuera y
  // sin forma de bajar hasta ahí — la pantalla parece no scrollear aunque
  // el ScrollView esté bien puesto.
  settingsContent: {
    flexGrow: 1,
    backgroundColor: colors.bg,
    paddingTop: 56,
    paddingHorizontal: 20,
    paddingBottom: 40,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  kicker: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 3,
  },
  title: {
    color: colors.text,
    fontSize: 30,
    fontWeight: '700',
    marginTop: 4,
    marginBottom: 18,
  },
  sectionLabel: {
    color: colors.accent2,
    fontSize: 14,
    fontWeight: '700',
    marginTop: 20,
  },
  intro: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 19,
    marginBottom: 8,
  },
  label: {
    color: colors.textMuted,
    fontSize: 13,
    marginBottom: 6,
    marginTop: 12,
    flexShrink: 1,
  },
  hint: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 17,
    marginBottom: 8,
  },
  labelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  getItButton: {
    backgroundColor: colors.glass,
    borderWidth: 1,
    borderColor: colors.stroke,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  getItButtonText: {
    color: colors.accent,
    fontSize: 12,
    fontWeight: '700',
  },
  error: {
    color: colors.danger,
    marginBottom: 12,
  },
  gearButton: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: colors.glass,
    borderWidth: 1,
    borderColor: colors.stroke,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gearButtonText: { color: colors.text, fontSize: 18 },
  syncButton: {
    backgroundColor: colors.accent2,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    marginBottom: 8,
  },
  syncInfo: {
    color: colors.textMuted,
    fontSize: 12,
    marginBottom: 18,
    textAlign: 'center',
  },
  addRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 18,
  },
  addRowMultiline: {
    gap: 10,
    marginBottom: 18,
  },
  input: {
    flex: 1,
    color: colors.text,
    backgroundColor: colors.glass,
    borderWidth: 1,
    borderColor: colors.stroke,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  // A diferencia de `input` (una línea, pensado para campos cortos), estos
  // reciben valores largos que se pegan de golpe (API keys, el enlace del
  // perfil de Steam, el bloque de texto de Epic): en una sola línea Android
  // los deja con scroll horizontal dentro de la caja y solo se ve un trozo,
  // así que crecen verticalmente para mostrar el texto pegado entero.
  inputMultiline: {
    color: colors.text,
    backgroundColor: colors.glass,
    borderWidth: 1,
    borderColor: colors.stroke,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    minHeight: 44,
    // 140 se quedaba corto para el bloque de texto de Epic (bastante más
    // largo que una API key o una URL): el campo dejaba de crecer y el
    // resto del texto pegado quedaba fuera de la vista, solo alcanzable
    // scrolleando dentro de la caja — un gesto que compite con el scroll
    // de la pantalla que lo envuelve y que en Android no siempre gana.
    // 260 cubre ese bloque completo en la mayoría de los casos sin
    // depender de ese scroll interno.
    maxHeight: 260,
  },
  addButton: {
    backgroundColor: colors.accent,
    borderRadius: 10,
    paddingHorizontal: 18,
    justifyContent: 'center',
  },
  addButtonEnd: {
    alignSelf: 'flex-end',
    paddingVertical: 10,
  },
  addButtonText: { color: colors.bg, fontWeight: '700' },
  secondaryButton: {
    borderRadius: 10,
    paddingHorizontal: 18,
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.stroke,
  },
  secondaryButtonText: { color: colors.text, fontWeight: '700' },
  settingsButtons: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 24,
  },
  listContent: {
    flexGrow: 1,
    paddingTop: 56,
    paddingHorizontal: 20,
    paddingBottom: 40,
  },
  empty: { color: colors.textMuted, marginTop: 24, textAlign: 'center' },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.glass,
    borderWidth: 1,
    borderColor: colors.stroke,
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
  },
  cardIcon: {
    width: 36,
    height: 36,
    borderRadius: 8,
    marginRight: 12,
  },
  cardIconPlaceholder: { backgroundColor: colors.stroke },
  cardTitle: { color: colors.text, fontSize: 16, fontWeight: '600' },
  cardPlatform: { color: colors.accent2, fontSize: 12, marginTop: 3 },
  cardFlags: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  cardAchievements: { color: colors.textMuted, fontSize: 12, marginTop: 3 },
  cardFlag: { color: colors.textMuted, fontSize: 12, marginTop: 3 },
  cardRight: { alignItems: 'flex-end', gap: 8 },
  cardHours: { color: colors.accent, fontWeight: '700' },
  cardActions: { flexDirection: 'row', gap: 6 },
  cardActionBtn: {
    width: 30,
    height: 30,
    borderRadius: 8,
    backgroundColor: colors.glass,
    borderWidth: 1,
    borderColor: colors.stroke,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardActionBtnActive: {
    backgroundColor: colors.accent2,
    borderColor: colors.accent2,
  },
  cardActionBtnText: { fontSize: 13 },

  // --- pestañas (biblioteca y Ajustes comparten el mismo estilo visual) ---
  tabsRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  tabButton: {
    flex: 1,
    borderRadius: 10,
    paddingVertical: 8,
    alignItems: 'center',
    backgroundColor: colors.glass,
    borderWidth: 1,
    borderColor: colors.stroke,
  },
  tabButtonActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  tabButtonText: { color: colors.textMuted, fontSize: 12, fontWeight: '700' },
  tabButtonTextActive: { color: colors.bg },
  rouletteButton: {
    backgroundColor: colors.glass,
    borderWidth: 1,
    borderColor: colors.accent,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
    marginBottom: 10,
  },
  buttonDisabled: { opacity: 0.4 },

  // --- Ajustes: Apariencia (paleta de temas) ---
  themeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginTop: 8,
  },
  themeCard: {
    width: '30%',
    alignItems: 'center',
    padding: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  themeCardActive: {
    borderColor: colors.accent,
    backgroundColor: colors.glass,
  },
  themeSwatch: {
    width: 56,
    height: 56,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 4,
  },
  themeSwatchDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  themeCheck: {
    position: 'absolute',
    top: 2,
    right: 4,
    fontSize: 12,
    fontWeight: '700',
  },
  themeName: {
    color: colors.textMuted,
    fontSize: 11,
    marginTop: 6,
    textAlign: 'center',
  },

  // --- ficha de un juego ---
  backLink: { color: colors.accent, fontWeight: '700', marginBottom: 18 },
  gameHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 8 },
  gameHeaderIcon: { width: 64, height: 64, borderRadius: 12 },
  statsRow: { gap: 4, marginBottom: 8 },
  statBig: { color: colors.text, fontSize: 14 },
  sessionRow: {
    flexDirection: 'row',
    gap: 12,
    backgroundColor: colors.glass,
    borderWidth: 1,
    borderColor: colors.stroke,
    borderRadius: 10,
    padding: 12,
    marginTop: 8,
    alignItems: 'center',
  },
  sessionMinutes: { color: colors.accent, fontWeight: '700', width: 56 },
  sessionWhen: { color: colors.text, fontSize: 13 },
  sessionMeta: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
  achievementRow: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'center',
    backgroundColor: colors.glass,
    borderWidth: 1,
    borderColor: colors.stroke,
    borderRadius: 10,
    padding: 12,
    marginTop: 8,
  },
  achievementIcon: { fontSize: 20 },
  achievementName: { color: colors.text, fontWeight: '600' },
  achievementDesc: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
  achievementDate: { color: colors.textMuted, fontSize: 11 },
  textMuted: { color: colors.textMuted },

  // --- ruleta ---
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  modalBox: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.stroke,
    borderRadius: 16,
    padding: 20,
  },
  modalCloseBtn: {
    position: 'absolute',
    top: 12,
    right: 12,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.glass,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1,
  },
  modalCloseBtnText: { color: colors.text, fontSize: 18, lineHeight: 20 },
  wheelBox: {
    minHeight: 120,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.glass,
    borderWidth: 1,
    borderColor: colors.stroke,
    borderRadius: 12,
    paddingHorizontal: 16,
    marginVertical: 16,
  },
  wheelSpinningName: {
    color: colors.accent,
    fontSize: 20,
    fontWeight: '700',
    textAlign: 'center',
  },
  wheelResult: { color: colors.text, fontSize: 16, textAlign: 'center' },
  wheelResultName: { color: colors.accent, fontWeight: '700' },
  });
}
