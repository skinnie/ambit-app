import React, { useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Alert, ScrollView, ActivityIndicator,
} from 'react-native';
import {
  sendRouteToWatch, SendRouteState,
  exportNavigationToGpx, ExportNavState,
  Transport,
} from '../services/NavigationService';
import { t } from '../i18n';

export default function RouteScreen() {
  const [sendState, setSendState] = useState<SendRouteState>({ phase: 'idle' });
  const [sendTransport, setSendTransport] = useState<Transport>('usb');
  const sendBusy = sendState.phase !== 'idle' && sendState.phase !== 'done' && sendState.phase !== 'error';

  const [exportState, setExportState] = useState<ExportNavState>({ phase: 'idle' });
  const [exportTransport, setExportTransport] = useState<Transport>('usb');
  const exportBusy = exportState.phase !== 'idle' && exportState.phase !== 'done' && exportState.phase !== 'error';

  const anyBusy = sendBusy || exportBusy;

  // BLE only: the watch's "Sync now" action only advertises for a short
  // window (confirmed on hardware 2026-08-06), too short to trigger before an
  // unpredictable-length step like the GPX file picker. So instead of hoping
  // the timing lines up, pause right before the scan actually starts and make
  // the user confirm they've just triggered it — see sendRouteToWatch's
  // onBleReady doc in NavigationService.ts.
  function waitForSyncNowTap(): Promise<void> {
    return new Promise(resolve => {
      Alert.alert(
        t.bleSyncNowTitle,
        t.bleSyncNowMsg,
        [{ text: t.bleSyncNowReady, onPress: () => resolve() }],
        { cancelable: false }
      );
    });
  }

  function handleSendRoute(transport: Transport) {
    if (anyBusy) return;
    setSendTransport(transport);
    Alert.alert(
      t.sendRouteConfirmTitle,
      transport === 'ble' ? `${t.sendRouteConfirmMsg}\n\n${t.bleExperimentalDisclaimer}` : t.sendRouteConfirmMsg,
      [
        { text: t.cancel, style: 'cancel' },
        { text: t.sendRouteConfirmBtn, onPress: () => runSendRoute(transport) },
      ]
    );
  }

  async function runSendRoute(transport: Transport) {
    try {
      await sendRouteToWatch(setSendState, transport, transport === 'ble' ? waitForSyncNowTap : undefined);
    } catch (e: any) {
      Alert.alert(t.error, e?.message ?? t.unknownError);
      setSendState({ phase: 'error', error: e?.message });
    }
  }

  async function handleExportNav(transport: Transport) {
    if (anyBusy) return;
    setExportTransport(transport);
    try {
      await exportNavigationToGpx(setExportState, transport, transport === 'ble' ? waitForSyncNowTap : undefined);
      setExportState(s => {
        if (s.phase === 'done') {
          Alert.alert(t.navExportedTitle, t.navExportedMsg(s.routeCount ?? 0, s.waypointCount ?? 0));
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

      {/* ── Send route to watch ── */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t.routeSendSection}</Text>
        <Text style={styles.sectionDesc}>{t.sendRouteConfirmMsg}</Text>

        <View style={styles.row}>
          <TouchableOpacity
            style={[styles.btn, styles.btnPrimary, anyBusy && styles.btnDisabled]}
            onPress={() => handleSendRoute('usb')}
            disabled={anyBusy}
          >
            {sendBusy && sendTransport === 'usb'
              ? <ActivityIndicator size="small" color="#fff" />
              : <Text style={styles.btnText}>{t.sendRoute}</Text>
            }
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.btn, styles.btnExperimental, anyBusy && styles.btnDisabled]}
            onPress={() => handleSendRoute('ble')}
            disabled={anyBusy}
          >
            {sendBusy && sendTransport === 'ble'
              ? <ActivityIndicator size="small" color="#fff" />
              : <Text style={styles.btnText}>{t.sendRouteBleBtn}</Text>
            }
          </TouchableOpacity>
        </View>
        <View style={styles.experimentalRow}>
          <Text style={styles.experimentalBadge}>{t.bleExperimentalBadge}</Text>
          <Text style={styles.experimentalText}>{t.bleExperimentalDisclaimer}</Text>
        </View>

        {sendBusy && (
          <View style={styles.statusRow}>
            <View style={styles.dot} />
            <Text style={styles.statusText}>{sendStatusMessage(sendState, sendTransport)}</Text>
          </View>
        )}
      </View>

      {/* ── Read routes/waypoints from watch, export to GPX ── */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t.routeExportSection}</Text>
        <Text style={styles.sectionDesc}>{t.routeExportDesc}</Text>

        <View style={styles.row}>
          <TouchableOpacity
            style={[styles.btn, styles.btnOrange, anyBusy && styles.btnDisabled]}
            onPress={() => handleExportNav('usb')}
            disabled={anyBusy}
          >
            {exportBusy && exportTransport === 'usb'
              ? <ActivityIndicator size="small" color="#fff" />
              : <Text style={styles.btnText}>{t.routeExportBtn}</Text>
            }
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.btn, styles.btnExperimental, anyBusy && styles.btnDisabled]}
            onPress={() => handleExportNav('ble')}
            disabled={anyBusy}
          >
            {exportBusy && exportTransport === 'ble'
              ? <ActivityIndicator size="small" color="#fff" />
              : <Text style={styles.btnText}>{t.routeExportBleBtn}</Text>
            }
          </TouchableOpacity>
        </View>
        <View style={styles.experimentalRow}>
          <Text style={styles.experimentalBadge}>{t.bleExperimentalBadge}</Text>
          <Text style={styles.experimentalText}>{t.bleExperimentalDisclaimer}</Text>
        </View>

        {exportBusy && (
          <View style={styles.statusRow}>
            <View style={styles.dot} />
            <Text style={styles.statusText}>
              {exportState.phase === 'connecting'
                ? (exportTransport === 'ble' ? t.bleConnecting : t.connecting)
                : t.routeExportReading}
            </Text>
          </View>
        )}
      </View>

    </ScrollView>
  );
}

function sendStatusMessage(s: SendRouteState, transport: Transport): string {
  switch (s.phase) {
    case 'idle':       return t.routeIdle;
    case 'picking':    return t.routePickingMsg;
    case 'parsing':    return t.routeParsingMsg;
    case 'connecting': return transport === 'ble' ? t.bleConnecting : t.connecting;
    case 'writing':    return t.routeWritingMsg;
    case 'done':       return t.routeDoneMsg(s.routeName ?? '', s.pointCount ?? 0, s.waypointCount ?? 0);
    case 'error':      return s.error ?? t.error;
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
  btnExperimental: { backgroundColor: '#ffb30022', borderWidth: 1, borderColor: '#ffb300' },
  btnDisabled: { opacity: 0.5 },
  btnText: { color: '#fff', fontWeight: '600', fontSize: 14 },
  statusRow: { flexDirection: 'row', alignItems: 'center', marginTop: 10 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#4caf50', marginRight: 6 },
  dotError: { backgroundColor: '#ff5252' },
  statusText: { color: '#4caf50', fontSize: 12 },
  statusTextError: { color: '#ff5252', flex: 1 },
  experimentalRow: { flexDirection: 'row', alignItems: 'flex-start', marginTop: 10, gap: 6 },
  experimentalBadge: {
    color: '#ffb300', fontSize: 10, fontWeight: '700',
    borderWidth: 1, borderColor: '#ffb300', borderRadius: 4,
    paddingHorizontal: 4, paddingVertical: 1,
  },
  experimentalText: { flex: 1, color: '#8899aa', fontSize: 11, lineHeight: 15 },
});
