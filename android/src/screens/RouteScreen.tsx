import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, Alert, ScrollView, TouchableOpacity } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../../App';
import {
  pickAndParseRoute, uploadRoute, readOnWatchNavigation, exportSingleRouteToGpx,
  PendingRoute, SendRouteState,
} from '../services/NavigationService';
import { WatchRoute } from '../services/RouteReader';
import { t } from '../i18n';
import { useV3Theme, v3Spacing, v3Type } from '../theme/v3';
import { Card } from '../components/ui/Card';
import { Button, StatusLine } from '../components/ui/primitives';
import { TrackPreview } from '../components/TrackPreview';

type Nav = NativeStackNavigationProp<RootStackParamList, 'Route'>;

// v3.0 UI port (2026-08-09, "re do routes... to match entirely desktop") - real structural
// rebuild matching desktop's own RoutesPage.qml: an "Import a route" card with a real
// preview (name/points/track shape) before you commit to uploading, not one opaque
// pick-and-immediately-write button, and a real "On the watch" card listing every route
// already there with its own track preview and a per-route Export - this screen used to be
// pure action buttons with no browsing at all.
function formatDist(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`;
}

export default function RouteScreen() {
  const theme = useV3Theme();
  const styles = createStyles(theme);
  const navigation = useNavigation<Nav>();

  const [pending, setPending] = useState<PendingRoute | null>(null);
  const [picking, setPicking] = useState(false);
  const [sendState, setSendState] = useState<SendRouteState>({ phase: 'idle' });
  const sendBusy = sendState.phase === 'connecting' || sendState.phase === 'writing';

  const [onWatch, setOnWatch] = useState<WatchRoute[] | null>(null);
  const [onWatchLoading, setOnWatchLoading] = useState(false);
  const [onWatchError, setOnWatchError] = useState<string | undefined>();
  const [exportingIndex, setExportingIndex] = useState<number | null>(null);

  const loadOnWatch = useCallback(async () => {
    setOnWatchLoading(true);
    setOnWatchError(undefined);
    try {
      const nav = await readOnWatchNavigation();
      setOnWatch(nav.routes);
    } catch (e: any) {
      setOnWatchError(e?.message ?? t.unknownError);
    } finally {
      setOnWatchLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { loadOnWatch(); }, [loadOnWatch]));

  async function handlePick() {
    if (picking || sendBusy) return;
    setPicking(true);
    try {
      const route = await pickAndParseRoute();
      if (route) setPending(route);
    } catch (e: any) {
      Alert.alert(t.error, e?.message ?? t.unknownError);
    } finally {
      setPicking(false);
    }
  }

  function handleUpload() {
    if (!pending || sendBusy) return;
    Alert.alert(
      t.sendRouteConfirmTitle,
      t.sendRouteConfirmMsg,
      [
        { text: t.cancel, style: 'cancel' },
        { text: t.sendRouteConfirmBtn, onPress: runUpload },
      ]
    );
  }

  async function runUpload() {
    if (!pending) return;
    try {
      await uploadRoute(pending, setSendState);
      setSendState(s => {
        if (s.phase === 'done') {
          setPending(null);
          loadOnWatch();
        } else if (s.phase === 'error') {
          Alert.alert(t.error, s.error ?? t.unknownError);
        }
        return s;
      });
    } catch (e: any) {
      Alert.alert(t.error, e?.message ?? t.unknownError);
      setSendState({ phase: 'error', error: e?.message });
    }
  }

  async function handleExportItem(route: WatchRoute, index: number) {
    if (exportingIndex !== null) return;
    setExportingIndex(index);
    try {
      await exportSingleRouteToGpx(route);
    } catch (e: any) {
      Alert.alert(t.error, e?.message ?? t.unknownError);
    } finally {
      setExportingIndex(null);
    }
  }

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>

      {/* ── Import a route ── */}
      <Card style={{ width: '100%' }}>
        <Text style={styles.cardTitle}>{t.routeSendSection}</Text>
        <Button label={t.routeIdle} variant="filled" loading={picking} disabled={picking || sendBusy} onPress={handlePick} style={{ marginTop: v3Spacing.small }} />

        {pending && (
          <View style={{ marginTop: v3Spacing.medium, gap: v3Spacing.small }}>
            <TrackPreview points={pending.points.map(p => ({ lat: p.lat, lon: p.lon }))} />
            <Text style={styles.itemName}>{pending.name}</Text>
            <Text style={styles.itemStats}>
              {t.routeStats(formatDist(pending.distanceM), pending.points.length, pending.ascentM, pending.descentM)}
            </Text>
            <View style={styles.row}>
              <Button label={t.routeUploadBtn} variant="filled" loading={sendBusy} disabled={sendBusy} onPress={handleUpload} />
              <Button label={t.routeDiscardBtn} variant="text" grow={false} disabled={sendBusy} onPress={() => setPending(null)} />
            </View>
            {pending.points.length > 1 && (
              <Button
                label={t.routeItemMapBtn}
                variant="outline"
                grow={false}
                onPress={() => navigation.navigate('TrackMap', {
                  title: pending.name,
                  points: pending.points.map(p => ({ lat: p.lat, lon: p.lon })),
                })}
              />
            )}
            {sendBusy && <StatusLine text={sendState.phase === 'connecting' ? t.connecting : t.routeWritingMsg} />}
          </View>
        )}
      </Card>

      {/* ── On the watch ── */}
      <Card style={{ width: '100%' }}>
        <Text style={styles.cardTitle}>{t.routeOnWatchSection}</Text>

        {onWatchLoading && (
          <StatusLine text={t.routeOnWatchReading} />
        )}
        {!onWatchLoading && onWatchError && (
          <Text style={[styles.itemStats, { color: theme.error, marginTop: v3Spacing.small }]}>
            {t.routeOnWatchError(onWatchError)}
          </Text>
        )}
        {!onWatchLoading && !onWatchError && onWatch && onWatch.length === 0 && (
          <Text style={[styles.itemStats, { marginTop: v3Spacing.small }]}>{t.routeOnWatchEmpty}</Text>
        )}

        {!onWatchLoading && onWatch && onWatch.map((route, i) => (
          <View key={`${route.name}-${i}`} style={i > 0 ? styles.onWatchItem : { marginTop: v3Spacing.medium, gap: v3Spacing.small }}>
            {route.points.length > 1 && <TrackPreview points={route.points.map(p => ({ lat: p.latitude, lon: p.longitude }))} height={120} />}
            <View style={styles.row}>
              <View style={{ flex: 1 }}>
                <Text style={styles.itemName}>{route.name}</Text>
                <Text style={styles.itemStats}>
                  {t.routeStats(formatDist(route.distanceM), route.points.length, route.ascentM, route.descentM)}
                </Text>
              </View>
              <View style={styles.itemBtnCol}>
                {route.points.length > 1 && (
                  <TouchableOpacity
                    style={styles.exportBtn}
                    onPress={() => navigation.navigate('TrackMap', {
                      title: route.name,
                      points: route.points.map(p => ({ lat: p.latitude, lon: p.longitude })),
                    })}
                  >
                    <Text style={styles.exportBtnText}>{t.routeItemMapBtn}</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity
                  style={styles.exportBtn}
                  disabled={exportingIndex !== null}
                  onPress={() => handleExportItem(route, i)}
                >
                  <Text style={styles.exportBtnText}>
                    {exportingIndex === i ? '…' : t.routeItemExportBtn}
                  </Text>
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
  row: { flexDirection: 'row', alignItems: 'center', gap: v3Spacing.small },
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
