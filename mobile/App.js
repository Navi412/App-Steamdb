import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
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
const { openDatabase } = require('./db/connection');
const { migrate } = require('./db/migrate');
const gamesDb = require('../db/games');
const settingsDb = require('../db/settings');
const { groupGames } = require('../core/group-games');
const { validateManualGame } = require('../core/game');
const { runSync } = require('../sync/run');
const { runXboxSync } = require('../xbox/run');
const { runEpicSync, loginWithCode } = require('../epic/run');

// Igual que setup/validate.js -> extractEpicCode, duplicado aquí en vez de
// importado: ese módulo también carga epic/file-auth-store.js (node:fs),
// que Metro no sabe empaquetar.
function extractEpicCode(raw) {
  const match = String(raw || '').match(/authorizationCode["']?\s*[:=]\s*["']?([A-Za-z0-9]{16,})/i);
  const code = (match ? match[1] : raw) || '';
  return code.replace(/[^A-Za-z0-9]/g, '');
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

export default function App() {
  const [db, setDb] = useState(null);
  const [view, setView] = useState('library');
  const [games, setGames] = useState([]);
  const [error, setError] = useState(null);
  const [title, setTitle] = useState('');
  const [saving, setSaving] = useState(false);
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

  useEffect(() => {
    try {
      const database = openDatabase();
      migrate(database);
      setApiKey(settingsDb.getSetting(database, 'steamApiKey') || '');
      setSteamId(settingsDb.getSetting(database, 'steamId') || '');
      setXboxApiKey(settingsDb.getSetting(database, 'openxblApiKey') || '');
      setEpicAccountId(epicAuthStore(database).load()?.accountId || null);
      setDb(database);
    } catch (err) {
      setError(err.message);
    }
  }, []);

  const reload = useCallback(
    (database) => {
      const target = database || db;
      if (!target) return;
      setGames(groupGames(gamesDb.listGames(target)));
    },
    [db]
  );

  useEffect(() => {
    if (db) reload(db);
  }, [db, reload]);

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

  function onSaveSettings() {
    if (!db) return;
    settingsDb.setSetting(db, 'steamApiKey', apiKey.trim());
    settingsDb.setSetting(db, 'steamId', steamId.trim());
    settingsDb.setSetting(db, 'openxblApiKey', xboxApiKey.trim());
    setError(null);
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
    return (
      <View style={styles.container}>
        <StatusBar barStyle="light-content" backgroundColor={COLORS.bg} />
        <Text style={styles.kicker}>AJUSTES</Text>
        <Text style={styles.title}>Cuentas</Text>

        {error && <Text style={styles.error}>{error}</Text>}

        <Text style={styles.sectionLabel}>Steam</Text>
        <Text style={styles.label}>Steam API Key</Text>
        <TextInput
          style={styles.input}
          placeholder="https://steamcommunity.com/dev/apikey"
          placeholderTextColor={COLORS.textMuted}
          value={apiKey}
          onChangeText={setApiKey}
          autoCapitalize="none"
          autoCorrect={false}
        />

        <Text style={styles.label}>SteamID64</Text>
        <TextInput
          style={styles.input}
          placeholder="76561198..."
          placeholderTextColor={COLORS.textMuted}
          value={steamId}
          onChangeText={setSteamId}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="number-pad"
        />

        <Text style={styles.sectionLabel}>Xbox</Text>
        <Text style={styles.label}>OpenXBL API Key</Text>
        <TextInput
          style={styles.input}
          placeholder="https://xbl.io/console"
          placeholderTextColor={COLORS.textMuted}
          value={xboxApiKey}
          onChangeText={setXboxApiKey}
          autoCapitalize="none"
          autoCorrect={false}
        />

        <Text style={styles.sectionLabel}>Epic Games</Text>
        <Text style={styles.label}>
          {epicAccountId
            ? `Conectado (cuenta ${epicAccountId}).`
            : 'Con sesión abierta en epicgames.com, visita la URL de redirección del launcher y pega aquí el authorizationCode (o el JSON entero).'}
        </Text>
        <View style={styles.addRow}>
          <TextInput
            style={styles.input}
            placeholder="authorizationCode, o el texto entero"
            placeholderTextColor={COLORS.textMuted}
            value={epicCode}
            onChangeText={setEpicCode}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Pressable style={styles.addButton} onPress={onConnectEpic} disabled={connectingEpic}>
            {connectingEpic ? (
              <ActivityIndicator color={COLORS.bg} />
            ) : (
              <Text style={styles.addButtonText}>{epicAccountId ? 'Reconectar' : 'Conectar'}</Text>
            )}
          </Pressable>
        </View>

        <View style={styles.settingsButtons}>
          <Pressable style={styles.secondaryButton} onPress={() => setView('library')}>
            <Text style={styles.secondaryButtonText}>Cancelar</Text>
          </Pressable>
          <Pressable style={styles.addButton} onPress={onSaveSettings}>
            <Text style={styles.addButtonText}>Guardar</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.bg} />
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

      <View style={styles.addRow}>
        <TextInput
          style={styles.input}
          placeholder="Título del juego"
          placeholderTextColor={COLORS.textMuted}
          value={title}
          onChangeText={setTitle}
        />
        <Pressable style={styles.addButton} onPress={onAdd} disabled={saving}>
          {saving ? <ActivityIndicator color={COLORS.bg} /> : <Text style={styles.addButtonText}>Añadir</Text>}
        </Pressable>
      </View>

      {!db ? (
        <ActivityIndicator color={COLORS.accent} style={{ marginTop: 24 }} />
      ) : (
        <FlatList
          style={styles.list}
          data={games}
          keyExtractor={(g) => String(g.id)}
          ListEmptyComponent={<Text style={styles.empty}>Todavía no hay juegos. Añade uno arriba o sincroniza con Steam.</Text>}
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
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.bg,
    paddingTop: 56,
    paddingHorizontal: 20,
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
  label: {
    color: COLORS.textMuted,
    fontSize: 13,
    marginBottom: 6,
    marginTop: 12,
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
  addButton: {
    backgroundColor: COLORS.accent,
    borderRadius: 10,
    paddingHorizontal: 18,
    justifyContent: 'center',
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
  list: { flex: 1 },
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
