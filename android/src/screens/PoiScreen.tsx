import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, Alert, ScrollView, TouchableOpacity } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../../App';
import {
  addPoiToWatch, AddPoiState, readOnWatchPois, exportSinglePoiToGpx, pickAndParseWaypoints,
  WatchPoi,
} from '../services/PoiService';
import { t } from '../i18n';
import { useV3Theme, v3Spacing, v3Type } from '../theme/v3';
import { Card } from '../components/ui/Card';
import { Button, FieldRow } from '../components/ui/primitives';
import { TrackPreview } from '../components/TrackPreview';

type Nav = NativeStackNavigationProp<RootStackParamList, 'Poi'>;

// v3.0 UI port (2026-08-09, "re do... pois to match entirely desktop") - real structural
// rebuild matching desktop's own PoisPage.qml: "Add a POI" gets a live pin preview, "Import
// from GPX" now shows each parsed waypoint with its own real Add button (not one opaque
// write-everything action), and a real "On the watch" list with a per-POI preview + Export -
// this screen used to be pure action buttons with no browsing at all.
export default function PoiScreen() {
  const theme = useV3Theme();
  const styles = createStyles(theme);
  const navigation = useNavigation<Nav>();

  const [poiName, setPoiName] = useState('');
  const [poiLat, setPoiLat]   = useState('');
  const [poiLon, setPoiLon]   = useState('');
  const [poiState, setPoiState] = useState<AddPoiState>({ phase: 'idle' });
  const poiBusy = poiState.phase === 'connecting' || poiState.phase === 'writing';

  const [imported, setImported] = useState<WatchPoi[] | null>(null);
  const [importPicking, setImportPicking] = useState(false);
  const [addingIndex, setAddingIndex] = useState<number | null>(null);

  const [onWatch, setOnWatch] = useState<WatchPoi[] | null>(null);
  const [onWatchLoading, setOnWatchLoading] = useState(false);
  const [onWatchError, setOnWatchError] = useState<string | undefined>();
  const [exportingIndex, setExportingIndex] = useState<number | null>(null);

  const loadOnWatch = useCallback(async () => {
    setOnWatchLoading(true);
    setOnWatchError(undefined);
    try {
      setOnWatch(await readOnWatchPois());
    } catch (e: any) {
      setOnWatchError(e?.message ?? t.unknownError);
    } finally {
      setOnWatchLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { loadOnWatch(); }, [loadOnWatch]));

  const parsedLat = parseFloat(poiLat.replace(',', '.'));
  const parsedLon = parseFloat(poiLon.replace(',', '.'));
  const hasValidCoords = Number.isFinite(parsedLat) && parsedLat >= -90 && parsedLat <= 90
    && Number.isFinite(parsedLon) && parsedLon >= -180 && parsedLon <= 180;

  async function handleAddPoi() {
    if (poiBusy) return;
    if (!poiName.trim()) {
      Alert.alert(t.poiInvalid, t.poiNameRequired);
      return;
    }
    if (!hasValidCoords) {
      Alert.alert(t.poiInvalid, t.poiCoordsInvalid);
      return;
    }
    try {
      await addPoiToWatch(poiName.trim(), parsedLat, parsedLon, setPoiState);
      setPoiState(s => {
        if (s.phase === 'done') {
          setPoiName('');
          setPoiLat('');
          setPoiLon('');
          loadOnWatch();
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

  async function handleImportPick() {
    if (importPicking) return;
    setImportPicking(true);
    try {
      const wps = await pickAndParseWaypoints();
      if (wps) setImported(wps);
    } catch (e: any) {
      Alert.alert(t.error, e?.message ?? t.unknownError);
    } finally {
      setImportPicking(false);
    }
  }

  async function handleAddImported(wp: WatchPoi, index: number) {
    if (addingIndex !== null) return;
    setAddingIndex(index);
    try {
      await addPoiToWatch(wp.name, wp.latitude, wp.longitude, () => {});
      setImported(prev => prev?.filter((_, i) => i !== index) ?? null);
      loadOnWatch();
    } catch (e: any) {
      Alert.alert(t.error, e?.message ?? t.unknownError);
    } finally {
      setAddingIndex(null);
    }
  }

  async function handleExportItem(poi: WatchPoi, index: number) {
    if (exportingIndex !== null) return;
    setExportingIndex(index);
    try {
      await exportSinglePoiToGpx(poi);
    } catch (e: any) {
      Alert.alert(t.error, e?.message ?? t.unknownError);
    } finally {
      setExportingIndex(null);
    }
  }

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>

      {/* ── Add a POI ── */}
      <Card style={{ width: '100%' }}>
        <Text style={styles.cardTitle}>{t.poiSection}</Text>
        <FieldRow icon="poi" value={poiName} onChangeText={setPoiName} placeholder={t.poiNamePlaceholder} editable={!poiBusy} style={{ marginTop: v3Spacing.small }} />
        <View style={styles.row}>
          {/* Real bug, found live on device (2026-08-09): FieldRow's own `style` prop only
              reaches its inner TextInput, not the outer row container - passing flex:1
              directly to FieldRow sized the text *inside* each field, not the field's own
              box, so Longitude was pushed off the right edge of the screen instead of
              sitting beside Latitude. Wrapping each in its own flex:1 View is the real fix. */}
          <View style={{ flex: 1 }}>
            <FieldRow icon="map" value={poiLat} onChangeText={setPoiLat} placeholder={t.poiLat} keyboardType="numbers-and-punctuation" editable={!poiBusy} />
          </View>
          <View style={{ flex: 1 }}>
            <FieldRow icon="map" value={poiLon} onChangeText={setPoiLon} placeholder={t.poiLon} keyboardType="numbers-and-punctuation" editable={!poiBusy} />
          </View>
        </View>
        <View style={{ marginTop: v3Spacing.small }}>
          <TrackPreview
            points={hasValidCoords ? [{ lat: parsedLat, lon: parsedLon }] : []}
            markerOnly
          />
        </View>
        <Button label={t.poiAddBtn} variant="filled" loading={poiBusy} disabled={poiBusy} onPress={handleAddPoi} style={{ marginTop: v3Spacing.small }} />
        {hasValidCoords && (
          <Button
            label={t.poiItemMapBtn}
            variant="outline"
            grow={false}
            style={{ marginTop: v3Spacing.small }}
            onPress={() => navigation.navigate('TrackMap', {
              title: poiName.trim() || t.poiSection,
              points: [{ lat: parsedLat, lon: parsedLon }],
            })}
          />
        )}
      </Card>

      {/* ── Import from GPX ── */}
      <Card style={{ width: '100%' }}>
        <Text style={styles.cardTitle}>{t.poiImportSection}</Text>
        <Text style={styles.itemStats}>{t.poiImportDesc}</Text>
        <Button label={t.poiImportBtn} variant="filled" loading={importPicking} disabled={importPicking} onPress={handleImportPick} style={{ marginTop: v3Spacing.small }} />

        {imported && imported.map((wp, i) => (
          <View key={`${wp.name}-${i}`} style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.itemName} numberOfLines={1}>{wp.name}</Text>
              <Text style={styles.itemStats}>{t.poiCoords(wp.latitude, wp.longitude)}</Text>
            </View>
            <TouchableOpacity style={styles.exportBtn} disabled={addingIndex !== null} onPress={() => handleAddImported(wp, i)}>
              <Text style={styles.exportBtnText}>{addingIndex === i ? '…' : t.poiItemAddBtn}</Text>
            </TouchableOpacity>
          </View>
        ))}
      </Card>

      {/* ── On the watch ── */}
      <Card style={{ width: '100%' }}>
        <Text style={styles.cardTitle}>{t.poiOnWatchSection}</Text>

        {onWatchLoading && <Text style={styles.itemStats}>{t.poiOnWatchReading}</Text>}
        {!onWatchLoading && onWatchError && (
          <Text style={[styles.itemStats, { color: theme.error }]}>{t.poiOnWatchError(onWatchError)}</Text>
        )}
        {!onWatchLoading && !onWatchError && onWatch && onWatch.length === 0 && (
          <Text style={styles.itemStats}>{t.poiOnWatchEmpty}</Text>
        )}

        {!onWatchLoading && onWatch && onWatch.map((poi, i) => (
          <View key={`${poi.name}-${i}`} style={i > 0 ? styles.onWatchItem : { marginTop: v3Spacing.medium, gap: v3Spacing.small }}>
            <TrackPreview points={[{ lat: poi.latitude, lon: poi.longitude }]} markerOnly height={90} />
            <View style={styles.row}>
              <View style={{ flex: 1 }}>
                <Text style={styles.itemName} numberOfLines={1}>{poi.name}</Text>
                <Text style={styles.itemStats}>{t.poiCoords(poi.latitude, poi.longitude)}</Text>
              </View>
              <View style={styles.itemBtnCol}>
                <TouchableOpacity
                  style={styles.exportBtn}
                  onPress={() => navigation.navigate('TrackMap', {
                    title: poi.name,
                    points: [{ lat: poi.latitude, lon: poi.longitude }],
                  })}
                >
                  <Text style={styles.exportBtnText}>{t.poiItemMapBtn}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.exportBtn} disabled={exportingIndex !== null} onPress={() => handleExportItem(poi, i)}>
                  <Text style={styles.exportBtnText}>{exportingIndex === i ? '…' : t.poiItemExportBtn}</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        ))}
      </Card>

    </ScrollView>
  );
}

const createStyles = (t: ReturnType<typeof useV3Theme>) => StyleSheet.create({
  root: { flex: 1, backgroundColor: t.background },
  content: { padding: v3Spacing.medium, gap: v3Spacing.medium },
  cardTitle: { fontSize: v3Type.heading, fontWeight: '700', color: t.text },
  row: { flexDirection: 'row', alignItems: 'center', gap: v3Spacing.small, marginTop: v3Spacing.small },
  itemName: { fontSize: v3Type.bodyLarge, fontWeight: '700', color: t.text },
  itemStats: { fontSize: v3Type.label, color: t.mutedText, marginTop: 2 },
  onWatchItem: { marginTop: v3Spacing.large, paddingTop: v3Spacing.medium, borderTopWidth: 1, borderTopColor: t.mutedText + '22', gap: v3Spacing.small },
  itemBtnCol: { flexDirection: 'row', gap: v3Spacing.small },
  exportBtn: {
    paddingVertical: 8, paddingHorizontal: 12, borderRadius: 8,
    backgroundColor: t.primary + '1F', borderWidth: 1, borderColor: t.primary,
  },
  exportBtnText: { color: t.primary, fontWeight: '600', fontSize: v3Type.label },
});
