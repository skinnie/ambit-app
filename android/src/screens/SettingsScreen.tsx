import React, { useCallback, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, Alert, ScrollView, ActivityIndicator, Linking,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import {
  getRunalyzeApiKey, saveRunalyzeApiKey, removeRunalyzeApiKey,
} from '../services/ApiRunalyze';
import {
  isAuthenticated as liveloxIsAuth, getAuthorizationUrl, logout as liveloxLogout,
} from '../services/ApiLivelox';
import {
  isAuthenticated as stravaIsAuth, getAuthorizationUrl as stravaAuthUrl, logout as stravaLogout,
} from '../services/ApiStrava';
import { t } from '../i18n';

export default function SettingsScreen() {
  const [runalyzeKey, setRunalyzeKey]     = useState('');
  const [savedKey, setSavedKey]           = useState<string | null>(null);
  const [saving, setSaving]               = useState(false);
  const [liveloxAuth, setLiveloxAuth]     = useState(false);
  const [stravaAuth, setStravaAuth]       = useState(false);

  useFocusEffect(useCallback(() => {
    getRunalyzeApiKey().then(k => {
      setSavedKey(k);
      setRunalyzeKey(k ?? '');
    });
    liveloxIsAuth().then(setLiveloxAuth);
    stravaIsAuth().then(setStravaAuth);
  }, []));

  async function handleSaveRunalyze() {
    if (!runalyzeKey.trim()) {
      Alert.alert(t.emptyKey, t.emptyKeyMsg);
      return;
    }
    setSaving(true);
    try {
      await saveRunalyzeApiKey(runalyzeKey.trim());
      setSavedKey(runalyzeKey.trim());
      Alert.alert(t.savedOk, t.keySaved);
    } finally {
      setSaving(false);
    }
  }

  async function handleRemoveRunalyze() {
    await removeRunalyzeApiKey();
    setSavedKey(null);
    setRunalyzeKey('');
    Alert.alert(t.deleted, t.keyDeleted);
  }

  async function handleStravaConnect() {
    try {
      const url = stravaAuthUrl();
      await Linking.openURL(url);
    } catch (e: any) {
      Alert.alert(t.stravaError, e?.message ?? String(e));
    }
  }

  async function handleStravaDisconnect() {
    await stravaLogout();
    setStravaAuth(false);
    Alert.alert('Strava', t.stravaDisconnected);
  }

  async function handleLiveloxConnect() {
    try {
      const url = await getAuthorizationUrl();
      await Linking.openURL(url);
    } catch (e: any) {
      Alert.alert(t.liveloxError, e?.message ?? String(e));
    }
  }

  async function handleLiveloxDisconnect() {
    await liveloxLogout();
    setLiveloxAuth(false);
    Alert.alert('Livelox', t.liveloxDisconnected);
  }

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>

      {/* ── Strava ── */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t.stravaSection}</Text>
        <Text style={styles.sectionDesc}>{t.stravaSettingsDesc}</Text>
        {stravaAuth ? (
          <View>
            <View style={styles.statusRow}>
              <View style={styles.dot} />
              <Text style={styles.statusText}>{t.stravaConnectedStatus}</Text>
            </View>
            <TouchableOpacity style={[styles.btn, styles.btnDanger, { marginTop: 10 }]} onPress={handleStravaDisconnect}>
              <Text style={styles.btnText}>{t.stravaDisconnectBtn}</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity style={[styles.btn, styles.btnOrange, { marginTop: 10 }]} onPress={handleStravaConnect}>
            <Text style={styles.btnText}>{t.connect}</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* ── Livelox ── */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Livelox</Text>
        <Text style={styles.sectionDesc}>{t.liveloxSettingsDesc}</Text>
        {liveloxAuth ? (
          <View>
            <View style={styles.statusRow}>
              <View style={styles.dot} />
              <Text style={styles.statusText}>{t.liveloxConnectedStatus}</Text>
            </View>
            <TouchableOpacity style={[styles.btn, styles.btnDanger, { marginTop: 10 }]} onPress={handleLiveloxDisconnect}>
              <Text style={styles.btnText}>{t.liveloxDisconnectBtn}</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity style={[styles.btn, styles.btnPrimary, { marginTop: 10 }]} onPress={handleLiveloxConnect}>
            <Text style={styles.btnText}>{t.connect}</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* ── Runalyze ── */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t.runalyzeSection}</Text>
        <Text style={styles.sectionDesc}>{t.runalyzeDesc}</Text>
        <Text style={styles.sectionDesc}>
          {t.runalyzeApiHint}
          <Text style={styles.link}>{t.runalyzeApiLink}</Text>
        </Text>

        <Text style={styles.label}>{t.apiKey}</Text>
        <TextInput
          style={styles.input}
          value={runalyzeKey}
          onChangeText={setRunalyzeKey}
          placeholder={t.apiKeyPlaceholder}
          placeholderTextColor="#4a5a7a"
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
        />

        <View style={styles.row}>
          <TouchableOpacity
            style={[styles.btn, styles.btnPrimary, saving && styles.btnDisabled]}
            onPress={handleSaveRunalyze}
            disabled={saving}
          >
            {saving
              ? <ActivityIndicator size="small" color="#fff" />
              : <Text style={styles.btnText}>{t.saveBtn}</Text>
            }
          </TouchableOpacity>

          {savedKey && (
            <TouchableOpacity style={[styles.btn, styles.btnDanger]} onPress={handleRemoveRunalyze}>
              <Text style={styles.btnText}>{t.deleteBtn}</Text>
            </TouchableOpacity>
          )}
        </View>

        {savedKey && (
          <View style={styles.statusRow}>
            <View style={styles.dot} />
            <Text style={styles.statusText}>{t.keyStored}</Text>
          </View>
        )}
      </View>

    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#16213e' },
  content: { padding: 20 },
  section: {
    backgroundColor: '#0f3460',
    borderRadius: 14,
    padding: 16,
    marginBottom: 20,
  },
  sectionTitle: { fontSize: 17, fontWeight: '700', color: '#00e5ff', marginBottom: 8 },
  sectionDesc: { fontSize: 13, color: '#8899aa', marginBottom: 6, lineHeight: 19 },
  link: { color: '#00e5ff' },
  label: { fontSize: 13, color: '#8899aa', marginTop: 12, marginBottom: 4 },
  input: {
    backgroundColor: '#16213e',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#1a4a7a',
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#fff',
    fontSize: 14,
  },
  row: { flexDirection: 'row', gap: 10, marginTop: 12 },
  btn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnPrimary: { backgroundColor: '#00e5ff22', borderWidth: 1, borderColor: '#00e5ff' },
  btnOrange:  { backgroundColor: '#fc4c0222', borderWidth: 1, borderColor: '#fc4c02' },
  btnDanger:  { backgroundColor: '#f4433622', borderWidth: 1, borderColor: '#f44336' },
  btnDisabled: { opacity: 0.5 },
  btnText: { color: '#fff', fontWeight: '600', fontSize: 14 },
  statusRow: { flexDirection: 'row', alignItems: 'center', marginTop: 10 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#4caf50', marginRight: 6 },
  statusText: { color: '#4caf50', fontSize: 12 },
});
