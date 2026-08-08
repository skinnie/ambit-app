import React, { useState } from 'react';
import { View, Text, StyleSheet, Alert, ScrollView } from 'react-native';
import {
  sendRouteToWatch, SendRouteState,
  exportNavigationToGpx, ExportNavState,
  Transport,
} from '../services/NavigationService';
import { t } from '../i18n';
import { useTheme } from '../theme/useTheme';
import { Badge, Button, Section, StatusLine } from '../components/ui/primitives';

export default function RouteScreen() {
  const theme = useTheme();
  const styles = createStyles(theme);

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
      <Section title={t.routeSendSection} description={t.sendRouteConfirmMsg}>
        <View style={styles.row}>
          <Button
            label={t.sendRoute}
            variant="filled"
            loading={sendBusy && sendTransport === 'usb'}
            disabled={anyBusy}
            onPress={() => handleSendRoute('usb')}
          />
          <Button
            label={t.sendRouteBleBtn}
            variant="outline"
            loading={sendBusy && sendTransport === 'ble'}
            disabled={anyBusy}
            onPress={() => handleSendRoute('ble')}
          />
        </View>
        <View style={styles.experimentalRow}>
          <Badge label={t.bleExperimentalBadge} />
          <Text style={styles.experimentalText}>{t.bleExperimentalDisclaimer}</Text>
        </View>

        {sendBusy && <StatusLine text={sendStatusMessage(sendState, sendTransport)} />}
      </Section>

      {/* ── Read routes/waypoints from watch, export to GPX ── */}
      <Section title={t.routeExportSection} description={t.routeExportDesc}>
        <View style={styles.row}>
          <Button
            label={t.routeExportBtn}
            variant="filled"
            loading={exportBusy && exportTransport === 'usb'}
            disabled={anyBusy}
            onPress={() => handleExportNav('usb')}
          />
          <Button
            label={t.routeExportBleBtn}
            variant="outline"
            loading={exportBusy && exportTransport === 'ble'}
            disabled={anyBusy}
            onPress={() => handleExportNav('ble')}
          />
        </View>
        <View style={styles.experimentalRow}>
          <Badge label={t.bleExperimentalBadge} />
          <Text style={styles.experimentalText}>{t.bleExperimentalDisclaimer}</Text>
        </View>

        {exportBusy && (
          <StatusLine
            text={exportState.phase === 'connecting'
              ? (exportTransport === 'ble' ? t.bleConnecting : t.connecting)
              : t.routeExportReading}
          />
        )}
      </Section>

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

const createStyles = (t: ReturnType<typeof useTheme>) => StyleSheet.create({
  root: { flex: 1, backgroundColor: t.background },
  content: { padding: 20 },
  row: { flexDirection: 'row', gap: 10, marginTop: 4 },
  experimentalRow: { flexDirection: 'row', alignItems: 'flex-start', marginTop: 10, gap: 8 },
  experimentalText: { flex: 1, color: t.textMuted, fontSize: 11, lineHeight: 15 },
});
