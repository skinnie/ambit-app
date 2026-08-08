import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, Alert, ScrollView, ActivityIndicator,
} from 'react-native';
import {
  addPoiToWatch, AddPoiState, importPoisFromGpx, ImportPoiState, exportPoisToGpx, ExportPoiState,
} from '../services/PoiService';
import { t } from '../i18n';

export default function PoiScreen() {
  const [poiName, setPoiName] = useState('');
  const [poiLat, setPoiLat]   = useState('');
  const [poiLon, setPoiLon]   = useState('');
  const [poiState, setPoiState] = useState<AddPoiState>({ phase: 'idle' });
  const poiBusy = poiState.phase === 'connecting' || poiState.phase === 'writing';

  const [importState, setImportState] = useState<ImportPoiState>({ phase: 'idle' });
  const importBusy = importState.phase !== 'idle' && importState.phase !== 'done' && importState.phase !== 'error';

  const [exportState, setExportState] = useState<ExportPoiState>({ phase: 'idle' });
  const exportBusy = exportState.phase !== 'idle' && exportState.phase !== 'done' && exportState.phase !== 'error';

  const anyBusy = poiBusy || importBusy || exportBusy;

  async function handleAddPoi() {
    if (anyBusy) return;
    if (!poiName.trim()) {
      Alert.alert(t.poiInvalid, t.poiNameRequired);
      return;
    }
    const lat = parseFloat(poiLat.replace(',', '.'));
    const lon = parseFloat(poiLon.replace(',', '.'));
    if (Number.isNaN(lat) || lat < -90 || lat > 90 || Number.isNaN(lon) || lon < -180 || lon > 180) {
      Alert.alert(t.poiInvalid, t.poiCoordsInvalid);
      return;
    }
    try {
      await addPoiToWatch(poiName.trim(), lat, lon, setPoiState);
      setPoiState(s => {
        if (s.phase === 'done') {
          Alert.alert(t.poiAddedTitle, t.poiAddedMsg(poiName.trim()));
          setPoiName('');
          setPoiLat('');
          setPoiLon('');
        } else if (s.phase === 'error') {
          Alert.alert(t.error, s.error ?? t.unknownError);
        }
        return s;
      });
    } catch (e: any) {
      Alert.alert(t.error, e?.message ?? t.unknownError);
      setPoiState({ phase: 'error', error: e?.message });
    }
  }

  async function handleImportPois() {
    if (anyBusy) return;
    try {
      await importPoisFromGpx(setImportState);
      setImportState(s => {
        if (s.phase === 'done') {
          Alert.alert(t.poiImportedTitle, t.poiImportedMsg(s.imported ?? 0));
        } else if (s.phase === 'error') {
          Alert.alert(t.error, s.error ?? t.unknownError);
        }
        return s;
      });
    } catch (e: any) {
      Alert.alert(t.error, e?.message ?? t.unknownError);
      setImportState({ phase: 'error', error: e?.message });
    }
  }

  async function handleExportPois() {
    if (anyBusy) return;
    try {
      await exportPoisToGpx(setExportState);
      setExportState(s => {
        if (s.phase === 'done') {
          Alert.alert(t.poiExportedTitle, t.poiExportedMsg(s.count ?? 0));
        } else if (s.phase === 'error') {
          Alert.alert(t.error, s.error ?? t.unknownError);
        }
        return s;
      });
    } catch (e: any) {
      Alert.alert(t.error, e?.message ?? t.unknownError);
      setExportState({ phase: 'error', error: e?.message });
    }
  }

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>

      {/* ── Import from GPX ── */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t.poiImportSection}</Text>
        <Text style={styles.sectionDesc}>{t.poiImportDesc}</Text>

        <View style={styles.row}>
          <TouchableOpacity
            style={[styles.btn, styles.btnOrange, anyBusy && styles.btnDisabled]}
            onPress={handleImportPois}
            disabled={anyBusy}
          >
            {importBusy
              ? <ActivityIndicator size="small" color="#fff" />
              : <Text style={styles.btnText}>{t.poiImportBtn}</Text>
            }
          </TouchableOpacity>
        </View>

        {importBusy && (
          <View style={styles.statusRow}>
            <View style={styles.dot} />
            <Text style={styles.statusText}>{importStatusMessage(importState)}</Text>
          </View>
        )}
      </View>

      {/* ── Export to GPX (read from watch) ── */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t.poiExportSection}</Text>
        <Text style={styles.sectionDesc}>{t.poiExportDesc}</Text>

        <View style={styles.row}>
          <TouchableOpacity
            style={[styles.btn, styles.btnPrimary, anyBusy && styles.btnDisabled]}
            onPress={handleExportPois}
            disabled={anyBusy}
          >
            {exportBusy
              ? <ActivityIndicator size="small" color="#fff" />
              : <Text style={styles.btnText}>{t.poiExportBtn}</Text>
            }
          </TouchableOpacity>
        </View>

        {exportBusy && (
          <View style={styles.statusRow}>
            <View style={styles.dot} />
            <Text style={styles.statusText}>
              {exportState.phase === 'connecting' ? t.connecting : t.poiExportReading}
            </Text>
          </View>
        )}
      </View>

      {/* ── Manual entry ── */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t.poiSection}</Text>
        <Text style={styles.sectionDesc}>{t.poiDesc}</Text>

        <Text style={styles.label}>{t.poiName}</Text>
        <TextInput
          style={styles.input}
          value={poiName}
          onChangeText={setPoiName}
          placeholder={t.poiNamePlaceholder}
          placeholderTextColor="#4a5a7a"
          editable={!anyBusy}
        />

        <Text style={styles.label}>{t.poiLat}</Text>
        <TextInput
          style={styles.input}
          value={poiLat}
          onChangeText={setPoiLat}
          placeholder="48.8566"
          placeholderTextColor="#4a5a7a"
          keyboardType="numbers-and-punctuation"
          editable={!anyBusy}
        />

        <Text style={styles.label}>{t.poiLon}</Text>
        <TextInput
          style={styles.input}
          value={poiLon}
          onChangeText={setPoiLon}
          placeholder="2.3522"
          placeholderTextColor="#4a5a7a"
          keyboardType="numbers-and-punctuation"
          editable={!anyBusy}
        />

        <View style={styles.row}>
          <TouchableOpacity
            style={[styles.btn, styles.btnPrimary, anyBusy && styles.btnDisabled]}
            onPress={handleAddPoi}
            disabled={anyBusy}
          >
            {poiBusy
              ? <ActivityIndicator size="small" color="#fff" />
              : <Text style={styles.btnText}>{t.poiAddBtn}</Text>
            }
          </TouchableOpacity>
        </View>

        {poiBusy && (
          <View style={styles.statusRow}>
            <View style={styles.dot} />
            <Text style={styles.statusText}>
              {poiState.phase === 'connecting' ? t.connecting : t.poiWriting}
            </Text>
          </View>
        )}
      </View>

    </ScrollView>
  );
}

function importStatusMessage(s: ImportPoiState): string {
  switch (s.phase) {
    case 'picking':    return t.poiImportPicking;
    case 'parsing':    return t.poiImportParsing;
    case 'connecting': return t.connecting;
    case 'writing':    return t.poiImportWriting(s.imported ?? 0, s.total ?? 0);
    default:           return '';
  }
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
  btnDisabled: { opacity: 0.5 },
  btnText: { color: '#fff', fontWeight: '600', fontSize: 14 },
  statusRow: { flexDirection: 'row', alignItems: 'center', marginTop: 10 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#4caf50', marginRight: 6 },
  statusText: { color: '#4caf50', fontSize: 12 },
});
