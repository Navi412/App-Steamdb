import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Linking,
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
// Envuelto en try/catch porque un fallo aquí (p.ej. un require que Metro
// empaquetó pero que revienta al ejecutarse en el dispositivo) pasaba antes
// desapercibido: ocurre al evaluar el módulo, antes de que exista ningún
// componente que lo capture, así que sin esto la app se queda en una
// pantalla negra sin ninguna pista de qué falló.
let openDatabase, migrate, gamesDb, settingsDb, groupGames, validateManualGame;
let runSync, runXboxSync, runEpicSync, loginWithCode;
let bootError = null;
try {
  ({ openDatabase } = require('./db/connection'));
  ({ migrate } = require('./db/migrate'));
  gamesDb = require('../db/games');
  settingsDb = require('../db/settings');
  ({ groupGames } = require('../core/group-games'));
  ({ validateManualGame } = require('../core/game'));
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

const COLORS = {
  bg: '#0a0e1a',
  glass: 'rgba(255,255,255,0.06)',
  stroke: 'rgba(255,255,255,0.12)',
  text: '#e9edf8',
  textMuted: '#97a1bb',
  accent: '#7cc4ff',
  accent2: '#a996ff',
  danger: '#ff8ba0',
};

function formatHours(minutes) {
  return `${(minutes / 60).toFixed(1)} h`;
}

// Botón junto a cada campo de credencial: abre en el navegador la página
// exacta de donde se saca ese valor, para que rellenar Ajustes no dependa
// de saber ya dónde buscar (mismo espíritu que `setup/open-url.js` en
// escritorio, pero como botón en vez de paso automático de un wizard).
function GetItButton({ label, url }) {
  return (
    <Pressable style={styles.getItButton} onPress={() => openHelpUrl(url)}>
      <Text style={styles.getItButtonText}>{label} ↗</Text>
    </Pressable>
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
        <StatusBar barStyle="light-content" backgroundColor={COLORS.bg} />
        <Text style={styles.title}>Error al iniciar la app</Text>
        <Text style={styles.error}>{String(bootError.stack || bootError.message || bootError)}</Text>
      </View>
    );
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

  if (view === 'settings') {
    const firstRun = !apiKey || !steamId;
    return (
      <KeyboardAvoidingView
        style={styles.flexBg}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <StatusBar barStyle="light-content" backgroundColor={COLORS.bg} />
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={styles.settingsContent}
          keyboardShouldPersistTaps="handled"
        >
        <Text style={styles.kicker}>AJUSTES</Text>
        <Text style={styles.title}>Cuentas</Text>

        {firstRun && (
          <Text style={styles.intro}>
            Para sincronizar hace falta al menos Steam. Pulsa el botón junto a cada campo:
            te lleva a la página exacta donde se consigue, cópialo y pégalo aquí. Xbox y
            Epic son opcionales — si no te interesan, déjalos en blanco y pulsa «Saltar
            por ahora» o «Guardar» tal cual.
          </Text>
        )}

        {error && <Text style={styles.error}>{error}</Text>}

        <Text style={styles.sectionLabel}>Steam</Text>
        <View style={styles.labelRow}>
          <Text style={styles.label}>Steam API Key</Text>
          <GetItButton label="Conseguir clave" url={HELP_URLS.steamApiKey} />
        </View>
        <TextInput
          style={styles.inputMultiline}
          placeholder="Pega aquí la clave"
          placeholderTextColor={COLORS.textMuted}
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
          <GetItButton label="Ver mi perfil" url={HELP_URLS.steamProfile} />
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
          placeholderTextColor={COLORS.textMuted}
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
          <GetItButton label="Conseguir clave" url={HELP_URLS.openxbl} />
        </View>
        <TextInput
          style={styles.inputMultiline}
          placeholder="Pega aquí la clave"
          placeholderTextColor={COLORS.textMuted}
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
          <GetItButton label="Abrir página de Epic" url={HELP_URLS.epic} />
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
            placeholderTextColor={COLORS.textMuted}
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
              <ActivityIndicator color={COLORS.bg} />
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
              <ActivityIndicator color={COLORS.bg} />
            ) : (
              <Text style={styles.addButtonText}>Guardar</Text>
            )}
          </Pressable>
        </View>
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
      <StatusBar barStyle="light-content" backgroundColor={COLORS.bg} />
      <FlatList
        ref={scrollRef}
        style={styles.flexBg}
        contentContainerStyle={styles.listContent}
        keyboardShouldPersistTaps="handled"
        data={db ? games : []}
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

            <Pressable style={styles.syncButton} onPress={onSync} disabled={syncing}>
              {syncing ? (
                <ActivityIndicator color={COLORS.bg} />
              ) : (
                <Text style={styles.addButtonText}>Sincronizar con Steam</Text>
              )}
            </Pressable>
            {lastSync && <Text style={styles.syncInfo}>Última sincronización: {lastSync}</Text>}

            <Pressable style={styles.syncButton} onPress={onXboxSync} disabled={xboxSyncing}>
              {xboxSyncing ? (
                <ActivityIndicator color={COLORS.bg} />
              ) : (
                <Text style={styles.addButtonText}>Sincronizar con Xbox</Text>
              )}
            </Pressable>
            {lastXboxSync && <Text style={styles.syncInfo}>Última sincronización: {lastXboxSync}</Text>}

            <Pressable style={styles.syncButton} onPress={onEpicSync} disabled={epicSyncing}>
              {epicSyncing ? (
                <ActivityIndicator color={COLORS.bg} />
              ) : (
                <Text style={styles.addButtonText}>Sincronizar con Epic</Text>
              )}
            </Pressable>
            {lastEpicSync && <Text style={styles.syncInfo}>Última sincronización: {lastEpicSync}</Text>}

            <View style={styles.addRow} onLayout={rememberFieldY('title')}>
              <TextInput
                style={styles.input}
                placeholder="Título del juego"
                placeholderTextColor={COLORS.textMuted}
                value={title}
                onChangeText={setTitle}
                onFocus={() => scrollToField('title')}
              />
              <Pressable style={styles.addButton} onPress={onAdd} disabled={saving}>
                {saving ? <ActivityIndicator color={COLORS.bg} /> : <Text style={styles.addButtonText}>Añadir</Text>}
              </Pressable>
            </View>
          </View>
        }
        ListEmptyComponent={
          !db ? (
            <ActivityIndicator color={COLORS.accent} style={{ marginTop: 24 }} />
          ) : (
            <Text style={styles.empty}>Todavía no hay juegos. Añade uno arriba o sincroniza con Steam.</Text>
          )
        }
        renderItem={({ item }) => (
          <View style={styles.card}>
            {item.iconUrl ? (
              <Image source={{ uri: item.iconUrl }} style={styles.cardIcon} />
            ) : (
              <View style={[styles.cardIcon, styles.cardIconPlaceholder]} />
            )}
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle}>{item.title}</Text>
              <Text style={styles.cardPlatform}>{item.platforms.join(' · ')}</Text>
              {item.achievementsTotal > 0 && (
                <Text style={styles.cardAchievements}>
                  🏆 {item.achievementsUnlocked}/{item.achievementsTotal}
                </Text>
              )}
            </View>
            <Text style={styles.cardHours}>{formatHours(item.totalMinutes)}</Text>
          </View>
        )}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flexBg: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },
  container: {
    flex: 1,
    backgroundColor: COLORS.bg,
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
    backgroundColor: COLORS.bg,
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
    color: COLORS.textMuted,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 3,
  },
  title: {
    color: COLORS.text,
    fontSize: 30,
    fontWeight: '700',
    marginTop: 4,
    marginBottom: 18,
  },
  sectionLabel: {
    color: COLORS.accent2,
    fontSize: 14,
    fontWeight: '700',
    marginTop: 20,
  },
  intro: {
    color: COLORS.textMuted,
    fontSize: 13,
    lineHeight: 19,
    marginBottom: 8,
  },
  label: {
    color: COLORS.textMuted,
    fontSize: 13,
    marginBottom: 6,
    marginTop: 12,
    flexShrink: 1,
  },
  hint: {
    color: COLORS.textMuted,
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
    backgroundColor: COLORS.glass,
    borderWidth: 1,
    borderColor: COLORS.stroke,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  getItButtonText: {
    color: COLORS.accent,
    fontSize: 12,
    fontWeight: '700',
  },
  error: {
    color: COLORS.danger,
    marginBottom: 12,
  },
  gearButton: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: COLORS.glass,
    borderWidth: 1,
    borderColor: COLORS.stroke,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gearButtonText: { color: COLORS.text, fontSize: 18 },
  syncButton: {
    backgroundColor: COLORS.accent2,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    marginBottom: 8,
  },
  syncInfo: {
    color: COLORS.textMuted,
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
    color: COLORS.text,
    backgroundColor: COLORS.glass,
    borderWidth: 1,
    borderColor: COLORS.stroke,
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
    color: COLORS.text,
    backgroundColor: COLORS.glass,
    borderWidth: 1,
    borderColor: COLORS.stroke,
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
    backgroundColor: COLORS.accent,
    borderRadius: 10,
    paddingHorizontal: 18,
    justifyContent: 'center',
  },
  addButtonEnd: {
    alignSelf: 'flex-end',
    paddingVertical: 10,
  },
  addButtonText: { color: COLORS.bg, fontWeight: '700' },
  secondaryButton: {
    borderRadius: 10,
    paddingHorizontal: 18,
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: COLORS.stroke,
  },
  secondaryButtonText: { color: COLORS.text, fontWeight: '700' },
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
  empty: { color: COLORS.textMuted, marginTop: 24, textAlign: 'center' },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.glass,
    borderWidth: 1,
    borderColor: COLORS.stroke,
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
  cardIconPlaceholder: { backgroundColor: COLORS.stroke },
  cardTitle: { color: COLORS.text, fontSize: 16, fontWeight: '600' },
  cardPlatform: { color: COLORS.accent2, fontSize: 12, marginTop: 3 },
  cardAchievements: { color: COLORS.textMuted, fontSize: 12, marginTop: 3 },
  cardHours: { color: COLORS.accent, fontWeight: '700' },
});
