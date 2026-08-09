import React, { useState } from 'react';
import { StyleSheet, Alert, ScrollView } from 'react-native';
import {
  sendRouteToWatch, SendRouteState,
  exportNavigationToGpx, ExportNavState,
} from '../services/NavigationService';
import { t } from '../i18n';
import { useV3Theme } from '../theme/v3';
import { Button, Section, StatusLine } from '../components/ui/primitives';

// One button each for Send and Export (2026-08-09). Transport is auto-detected:
// the operations go through the shared, transport-aware connect()/disconnect()
// (see NavigationService), so they use whatever the watch is currently connected
// over — an existing BLE link (no re-scan/re-pair) or the USB cable — with no
// per-transport buttons or "trigger Sync now" prompts.
export default function RouteScreen() {
  const theme = useV3Theme();
  const styles = createStyles(theme);

  const [sendState, setSendState] = useState<SendRouteState>({ phase: 'idle' });
  const sendBusy = sendState.phase !== 'idle' && sendState.phase !== 'done' && sendState.phase !== 'error';

  const [exportState, setExportState] = useState<ExportNavState>({ phase: 'idle' });
  const exportBusy = exportState.phase !== 'idle' && exportState.phase !== 'done' && exportState.phase !== 'error';

  const anyBusy = sendBusy || exportBusy;

  function handleSendRoute() {
    if (anyBusy) return;
    Alert.alert(
      t.sendRouteConfirmTitle,
      t.sendRouteConfirmMsg,
      [
        { text: t.cancel, style: 'cancel' },
        { text: t.sendRouteConfirmBtn, onPress: runSendRoute },
      ]
    );
  }

  async function runSendRoute() {
    try {
      await sendRouteToWatch(setSendState);
    } catch (e: any) {
      Alert.alert(t.error, e?.message ?? t.unknownError);
      setSendState({ phase: 'error', error: e?.message });
    }
  }

  async function handleExportNav() {
    if (anyBusy) return;
    try {
      await exportNavigationToGpx(setExportState);
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
        <Button
          label={t.sendRoute}
          variant="filled"
          loading={sendBusy}
          disabled={anyBusy}
          onPress={handleSendRoute}
        />
        {sendBusy && <StatusLine text={sendStatusMessage(sendState)} />}
      </Section>

      {/* ── Read routes/waypoints from watch, export to GPX ── */}
      <Section title={t.routeExportSection} description={t.routeExportDesc}>
        <Button
          label={t.routeExportBtn}
          variant="filled"
          loading={exportBusy}
          disabled={anyBusy}
          onPress={handleExportNav}
        />
        {exportBusy && (
          <StatusLine
            text={exportState.phase === 'connecting' ? t.connecting : t.routeExportReading}
          />
        )}
      </Section>

    </ScrollView>
  );
}

function sendStatusMessage(s: SendRouteState): string {
  switch (s.phase) {
    case 'idle':       return t.routeIdle;
    case 'picking':    return t.routePickingMsg;
    case 'parsing':    return t.routeParsingMsg;
    case 'connecting': return t.connecting;
    case 'writing':    return t.routeWritingMsg;
    case 'done':       return t.routeDoneMsg(s.routeName ?? '', s.pointCount ?? 0, s.waypointCount ?? 0);
    case 'error':      return s.error ?? t.error;
    default:           return '';
  }
}

const createStyles = (t: ReturnType<typeof useV3Theme>) => StyleSheet.create({
  root: { flex: 1, backgroundColor: t.background },
  content: { padding: 20 },
});
