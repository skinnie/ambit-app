import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, Alert, ScrollView, TouchableOpacity, Modal, Pressable } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import {
  addPoiToWatch, AddPoiState, readOnWatchPois, getCachedPois, exportSinglePoiToGpx, pickAndParseWaypoints,
  WatchPoi,
} from '../services/PoiService';
import { t } from '../i18n';
import { useV3Theme, v3Spacing, v3Type } from '../theme/v3';
import { Card } from '../components/ui/Card';
import { Button, FieldRow } from '../components/ui/primitives';
import { TrackPreview } from '../components/TrackPreview';
import { getViewMode, setViewMode as persistViewMode, ViewMode } from '../services/ListViewPrefs';
import { ViewModeToggle } from '../components/ui/ViewModeToggle';

// v3.0 UI port (2026-08-09, "re do... pois to match entirely desktop") - real structural
// rebuild matching desktop's own PoisPage.qml: "Add a POI" gets a live pin preview, "Import
// from GPX" now shows each parsed waypoint with its own real Add button (not one opaque
// write-everything action), and a real "On the watch" list with a per-POI preview + Export -
// this screen used to be pure action buttons with no browsing at all.
//
// Real, same day ("I would prefer an immediate map view on this side") - TrackPreview
// itself now renders a real tile-map background (see its own header comment), so the
// separate tap-through "Map" button/TrackMapScreen this screen briefly had was removed -
// the preview already IS the map, immediately, matching desktop's own PoisPage.qml (a live
// MapView per item, no tap-through screen at all).
// The 18 Ambit POI type bytes (the icon the watch shows), from Lars's "Types of Poi.md"
// (assets/Lars) - the single source is tools/ambit_format.py's WAYPOINT_TYPES; array index ==
// the type id 0-17. Default "Waypoint" (17), what the watch itself uses.
const POI_TYPE_NAMES = [
  'Building', 'Cave', 'Camp', 'Car', 'Crossroads', 'Beginning', 'End', 'Food', 'Forest',
  'Geocache', 'Lodging', 'Meadow', 'Mountain', 'Sight', 'Road', 'Rock', 'Water', 'Waypoint',
];
// Material Symbols glyph per POI type (the icon the watch shows), same index. Codepoints from
// tools/subset_material_symbols.py, rendered with the bundled MaterialSymbolsRounded font
// (android/app/src/main/assets/fonts/). Cave/Rock use elevation / filter_hdr (no exact glyph).
const POI_TYPE_GLYPHS = [
  '\uea40', '\uf6e7', '\uea68', '\ue531', '\uebac', '\ue57b', '\uf06e', '\ue56c', '\uea99', '\ue87a', '\ue53a', '\uf205', '\ue3f7', '\ue3b0', '\ueacd', '\ue3df', '\ue798', '\ue0c8',
];

export default function PoiScreen() {
  const theme = useV3Theme();
  const styles = createStyles(theme);

  const [poiName, setPoiName] = useState('');
  const [poiLat, setPoiLat]   = useState('');
  const [poiLon, setPoiLon]   = useState('');
  const [poiType, setPoiType] = useState(17);  // Ambit POI type byte 0-17 (icon)
  const [poiState, setPoiState] = useState<AddPoiState>({ phase: 'idle' });
  const [infoOpen, setInfoOpen] = useState(false);  // the little "i" POI-note dialog
  const poiBusy = poiState.phase === 'connecting' || poiState.phase === 'writing';

  const [imported, setImported] = useState<WatchPoi[] | null>(null);
  const [importPicking, setImportPicking] = useState(false);
  const [addingIndex, setAddingIndex] = useState<number | null>(null);

  const [onWatch, setOnWatch] = useState<WatchPoi[] | null>(null);
  const [onWatchLoading, setOnWatchLoading] = useState(false);
  const [onWatchError, setOnWatchError] = useState<string | undefined>();
  const [exportingIndex, setExportingIndex] = useState<number | null>(null);
  // Map/list view (persisted Settings pref). POIs are single points, so no sort control
  // (name is the only meaningful key) - just the view toggle.
  const [viewMode, setViewMode] = useState<ViewMode>('map');
  useFocusEffect(useCallback(() => { getViewMode('pois').then(setViewMode); }, []));
  function changeViewMode(m: ViewMode) { setViewMode(m); persistViewMode('pois', m); }

  // Real, 2026-08-10 ("it is not upon the watch to give you that, is on the app to store
  // the activities, so they can load almost immediately and just refresh what is new") -
  // same real local-first pattern as RouteScreen.tsx's own loadOnWatch(): the persisted
  // cache renders instantly, a real watch read refreshes it silently in the background.
  const loadOnWatch = useCallback(async () => {
    const cached = await getCachedPois();
    if (cached) {
      setOnWatch(cached);
    } else {
      setOnWatchLoading(true);
    }
    setOnWatchError(undefined);
    try {
      setOnWatch(await readOnWatchPois());
    } catch (e: any) {
      if (!cached) setOnWatchError(e?.message ?? t.unknownError);
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
      await addPoiToWatch(poiName.trim(), parsedLat, parsedLon, setPoiState, poiType);
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
      {/* POI note dialog: what happens to POIs sent to the watch (André, 2026-08-17), same
          little "i" affordance as the Routes screen. */}
      <Modal visible={infoOpen} transparent animationType="fade" onRequestClose={() => setInfoOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setInfoOpen(false)}>
          <Pressable style={styles.dialogCard} onPress={() => {}}>
            <Text style={styles.dialogTitle}>{t.poiInfoTitle}</Text>
            <Text style={[styles.dialogText, { fontWeight: '700', marginTop: 4 }]}>{t.poiWatchNote}</Text>
            <TouchableOpacity style={styles.dialogClose} onPress={() => setInfoOpen(false)}>
              <Text style={styles.dialogCloseText}>{t.close}</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>

      <Card style={{ width: '100%' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text style={styles.cardTitle}>{t.poiSection}</Text>
          <TouchableOpacity style={styles.infoBadge} onPress={() => setInfoOpen(true)} hitSlop={8}>
            <Text style={styles.infoBadgeText}>i</Text>
          </TouchableOpacity>
        </View>
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
        {/* POI type (the icon the watch shows) - a horizontal chip picker, default Waypoint. */}
        <Text style={styles.typeLabel}>{t.poiType}</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: v3Spacing.small, paddingVertical: 2 }}>
          {POI_TYPE_NAMES.map((name, i) => (
            <TouchableOpacity key={i} disabled={poiBusy} onPress={() => setPoiType(i)}
              style={[styles.typeChipRow, poiType === i && styles.typeChipSel]}>
              <Text style={[styles.typeGlyph, poiType === i && styles.typeChipTextSel]}>{POI_TYPE_GLYPHS[i]}</Text>
              <Text style={[styles.typeChipText, poiType === i && styles.typeChipTextSel]}>{name}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
        <View style={{ marginTop: v3Spacing.small }}>
          <TrackPreview
            points={hasValidCoords ? [{ lat: parsedLat, lon: parsedLon }] : []}
            markerOnly
          />
        </View>
        <Button label={t.poiAddBtn} variant="filled" loading={poiBusy} disabled={poiBusy} onPress={handleAddPoi} style={{ marginTop: v3Spacing.small }} />
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
        {/* Title + map/list view dropdown, right after the title on the left (moved here from
            Settings, André 2026-08-16; matches desktop). */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Text style={styles.cardTitle}>{t.poiOnWatchSection}</Text>
          {!onWatchLoading && onWatch && onWatch.length > 0 && (
            <ViewModeToggle mode={viewMode} onChange={changeViewMode} />
          )}
        </View>

        {onWatchLoading && <Text style={styles.itemStats}>{t.poiOnWatchReading}</Text>}
        {!onWatchLoading && onWatchError && (
          <Text style={[styles.itemStats, { color: theme.error }]}>{t.poiOnWatchError(onWatchError)}</Text>
        )}
        {!onWatchLoading && !onWatchError && onWatch && onWatch.length === 0 && (
          <Text style={styles.itemStats}>{t.poiOnWatchEmpty}</Text>
        )}

        {!onWatchLoading && onWatch && onWatch.map((poi, i) => (
          <View key={`${poi.name}-${i}`} style={i > 0 ? styles.onWatchItem : { marginTop: v3Spacing.medium, gap: v3Spacing.small }}>
            {viewMode === 'map' && <TrackPreview points={[{ lat: poi.latitude, lon: poi.longitude }]} markerOnly height={90} />}
            <View style={styles.row}>
              <View style={{ flex: 1 }}>
                <Text style={styles.itemName} numberOfLines={1}>{poi.name}</Text>
                <Text style={styles.itemStats}>{t.poiCoords(poi.latitude, poi.longitude)}</Text>
              </View>
              <TouchableOpacity style={styles.exportBtn} disabled={exportingIndex !== null} onPress={() => handleExportItem(poi, i)}>
                <Text style={styles.exportBtnText}>{exportingIndex === i ? '…' : t.poiItemExportBtn}</Text>
              </TouchableOpacity>
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
  infoBadge: { width: 17, height: 17, borderRadius: 9, borderWidth: 1, borderColor: t.mutedText, alignItems: 'center', justifyContent: 'center' },
  infoBadgeText: { fontSize: 10, fontWeight: '700', color: t.mutedText, lineHeight: 11 },
  backdrop: { flex: 1, backgroundColor: '#00000066', alignItems: 'center', justifyContent: 'center', padding: 24 },
  dialogCard: { width: '100%', maxWidth: 420, backgroundColor: t.card, borderRadius: 14, padding: 16, paddingBottom: 40 },
  dialogTitle: { fontSize: v3Type.bodyLarge, fontWeight: '700', color: t.text },
  dialogText: { fontSize: v3Type.body, color: t.text, marginTop: 2 },
  dialogClose: { position: 'absolute', right: 10, bottom: 8, paddingVertical: 4, paddingHorizontal: 8 },
  dialogCloseText: { fontSize: v3Type.body, color: t.primary, fontWeight: '700' },
  row: { flexDirection: 'row', alignItems: 'center', gap: v3Spacing.small, marginTop: v3Spacing.small },
  itemName: { fontSize: v3Type.bodyLarge, fontWeight: '700', color: t.text },
  itemStats: { fontSize: v3Type.label, color: t.mutedText, marginTop: 2 },
  onWatchItem: { marginTop: v3Spacing.large, paddingTop: v3Spacing.medium, borderTopWidth: 1, borderTopColor: t.mutedText + '22', gap: v3Spacing.small },
  exportBtn: {
    paddingVertical: 8, paddingHorizontal: 12, borderRadius: 8,
    backgroundColor: t.primary + '1F', borderWidth: 1, borderColor: t.primary,
  },
  exportBtnText: { color: t.primary, fontWeight: '600', fontSize: v3Type.label },
  typeLabel: { fontSize: v3Type.label, color: t.mutedText, marginTop: v3Spacing.small, marginBottom: 4 },
  typeChipRow: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingVertical: 6, paddingHorizontal: 12, borderRadius: 999,
    borderWidth: 1, borderColor: t.mutedText + '55',
  },
  typeGlyph: { fontFamily: 'MaterialSymbolsRounded', fontSize: 16, color: t.text },
  typeChipSel: { backgroundColor: t.primary, borderColor: t.primary },
  typeChipText: { color: t.text, fontSize: v3Type.label },
  typeChipTextSel: { color: t.background, fontWeight: '700' },
});
