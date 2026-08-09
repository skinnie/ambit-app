import React, { useState } from 'react';
import { View, StyleSheet, Alert, ScrollView } from 'react-native';
import {
  addPoiToWatch, AddPoiState, importPoisFromGpx, ImportPoiState, exportPoisToGpx, ExportPoiState,
} from '../services/PoiService';
import { t } from '../i18n';
import { useV3Theme } from '../theme/v3';
import { Button, FieldRow, Section, StatusLine } from '../components/ui/primitives';

export default function PoiScreen() {
  const theme = useV3Theme();
  const styles = createStyles(theme);

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
      <Section title={t.poiImportSection} description={t.poiImportDesc}>
        <View style={styles.row}>
          <Button label={t.poiImportBtn} variant="filled" loading={importBusy} disabled={anyBusy} onPress={handleImportPois} />
        </View>
        {importBusy && <StatusLine text={importStatusMessage(importState)} />}
      </Section>

      {/* ── Export to GPX (read from watch) ── */}
      <Section title={t.poiExportSection} description={t.poiExportDesc}>
        <View style={styles.row}>
          <Button label={t.poiExportBtn} variant="filled" loading={exportBusy} disabled={anyBusy} onPress={handleExportPois} />
        </View>
        {exportBusy && (
          <StatusLine text={exportState.phase === 'connecting' ? t.connecting : t.poiExportReading} />
        )}
      </Section>

      {/* ── Manual entry ── */}
      <Section title={t.poiSection} description={t.poiDesc}>
        <FieldRow
          icon="poi"
          value={poiName}
          onChangeText={setPoiName}
          placeholder={t.poiNamePlaceholder}
          editable={!anyBusy}
        />
        <FieldRow
          icon="map"
          value={poiLat}
          onChangeText={setPoiLat}
          placeholder="48.8566"
          keyboardType="numbers-and-punctuation"
          editable={!anyBusy}
        />
        <FieldRow
          icon="map"
          value={poiLon}
          onChangeText={setPoiLon}
          placeholder="2.3522"
          keyboardType="numbers-and-punctuation"
          editable={!anyBusy}
        />

        <View style={styles.row}>
          <Button label={t.poiAddBtn} variant="filled" loading={poiBusy} disabled={anyBusy} onPress={handleAddPoi} />
        </View>

        {poiBusy && (
          <StatusLine text={poiState.phase === 'connecting' ? t.connecting : t.poiWriting} />
        )}
      </Section>

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

const createStyles = (t: ReturnType<typeof useV3Theme>) => StyleSheet.create({
  root: { flex: 1, backgroundColor: t.background },
  content: { padding: 20 },
  row: { flexDirection: 'row', gap: 10, marginTop: 4 },
});
