import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Alert, ScrollView } from 'react-native';
import { useV3Theme, v3Spacing, v3Type } from '../theme/v3';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/primitives';
import {
  connect, disconnect, pickGpxFile,
  firmwarePreflight, firmwareFlash, onFirmwarePhase, FirmwarePlan,
} from '../native/AmbitUsbModule';

// THE ONE WRITE THAT CAN BRICK. This screen is a faithful front-end for the Android firmware
// flasher (firmware_flash_android.c), which ports the desktop's hardware-proven firmware_write.py.
// The live flash is gated behind an explicit confirmation dialog and is NOT hardware-tested on
// Android yet — the intended first use is a supervised session, using "Stream only" (recoverable,
// leaves the watch in BSL) to validate the transport BEFORE ever committing.

interface DevInfo { model?: string; serial?: string; fwVersion?: string; hwVersion?: string; battery?: number; }

export default function FirmwareScreen() {
  const theme = useV3Theme();
  const s = createStyles(theme);
  const [path, setPath] = useState<string | null>(null);
  const [plan, setPlan] = useState<FirmwarePlan | null>(null);
  const [dev, setDev] = useState<DevInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<string>('');

  useEffect(() => onFirmwarePhase(e => setPhase(`${e.phase}: ${e.message}`)), []);

  async function choose() {
    try {
      const p = await pickGpxFile(); // content-agnostic file pick; bytes validated by SFI2ST magic
      if (p) { setPath(p); setPlan(null); setDev(null); }
    } catch (e: any) { Alert.alert('File', e?.message ?? 'pick cancelled'); }
  }

  async function preflight() {
    if (!path) return;
    setBusy(true); setPhase('');
    try {
      await connect();
      const pl = await firmwarePreflight(path);
      setPlan(pl);
      try { setDev(JSON.parse(pl.deviceInfoJson)); } catch { setDev(null); }
    } catch (e: any) {
      Alert.alert('Preflight failed', e?.message ?? 'error');
    } finally {
      await disconnect().catch(() => {});
      setBusy(false);
    }
  }

  const battery = dev?.battery ?? -1;
  const batteryLow = battery >= 0 && battery < 30;

  async function runFlash(commit: boolean) {
    if (!path) return;
    setBusy(true); setPhase('');
    try {
      await connect();
      await firmwareFlash(path, commit, true /* confirm */);
      Alert.alert(commit ? 'Flash complete' : 'Stream complete',
        commit ? 'The watch has rebooted with the new firmware (verify on the watch).'
               : 'Streamed without committing. The watch is in BSL — recoverable: re-run with commit, or power-cycle.');
    } catch (e: any) {
      Alert.alert('Flash error', `${e?.message ?? 'error'}\n\nIf the watch is stuck in BSL it is recoverable: re-run the commit, or use SuuntoLink.`);
    } finally {
      await disconnect().catch(() => {});
      setBusy(false);
    }
  }

  function confirmStreamOnly() {
    Alert.alert('Stream only (recoverable test)',
      'This enters the bootloader and streams the whole image but STOPS before committing. ' +
      'The watch is left in BSL and is fully recoverable. Keep the USB cable still. Proceed?',
      [{ text: 'Cancel', style: 'cancel' }, { text: 'Stream', onPress: () => runFlash(false) }]);
  }

  function confirmCommit() {
    Alert.alert('⚠ Flash firmware (irreversible)',
      `This writes new firmware to the ${dev?.model ?? 'watch'} and reboots it. A wrong image or an ` +
      'interruption can brick the watch. Only do this supervised, with a matching image and the cable still.\n\n' +
      'Type-of-no-return: the commit cannot be undone. Proceed?',
      [{ text: 'Cancel', style: 'cancel' },
       { text: 'Flash now', style: 'destructive', onPress: () => runFlash(true) }]);
  }

  return (
    <ScrollView style={s.root} contentContainerStyle={s.content}>
      <Card style={s.card}>
        <Text style={s.title}>Firmware</Text>
        <Text style={s.warn}>
          The one write that can brick. Untested on Android — intended for a supervised session.
          Use “Stream only” first (recoverable) before committing.
        </Text>
        <Button label={path ? 'Firmware file selected — choose another' : 'Choose firmware file (.sfi)'}
          icon="download" variant="outline" onPress={choose} disabled={busy} />
        {!!path && <Text style={s.pathText} numberOfLines={1}>{path}</Text>}
      </Card>

      {!!path && (
        <Card style={s.card}>
          <Text style={s.sectionTitle}>Preflight</Text>
          <Button label="Connect & check (no write)" icon="sync" onPress={preflight} loading={busy} disabled={busy} />
          {!!plan && (
            <View style={s.planBox}>
              <Row s={s} k="Watch" v={dev?.model ?? '—'} />
              <Row s={s} k="Serial" v={dev?.serial ?? '—'} />
              <Row s={s} k="Firmware" v={dev?.fwVersion ?? '—'} />
              <Row s={s} k="Hardware" v={dev?.hwVersion ?? '—'} />
              <Row s={s} k="Battery" v={battery >= 0 ? `${battery}%` : '—'} alert={batteryLow} />
              <Row s={s} k="Image" v={`32 B header + ${plan.payloadLen.toLocaleString()} B → ${plan.chunks} chunks`} />
              {batteryLow && <Text style={s.alertText}>Battery under 30% — charge before flashing.</Text>}
            </View>
          )}
        </Card>
      )}

      {!!plan && (
        <Card style={s.card}>
          <Text style={s.sectionTitle}>Flash</Text>
          <Text style={s.warn}>Make sure the image matches this exact watch model. Keep the cable still.</Text>
          <Button label="Stream only (safe, recoverable)" icon="upload" variant="outline"
            onPress={confirmStreamOnly} disabled={busy || batteryLow} />
          <View style={{ height: v3Spacing.small }} />
          <Button label="Flash (commit — irreversible)" icon="warning" tone="alert"
            onPress={confirmCommit} disabled={busy || batteryLow} />
        </Card>
      )}

      {!!phase && (
        <Card style={s.card}>
          <Text style={s.sectionTitle}>Progress</Text>
          <Text style={s.phaseText}>{phase}</Text>
          <Text style={s.hint}>Detailed per-chunk progress is in logcat (tag AmbitJNI).</Text>
        </Card>
      )}
    </ScrollView>
  );
}

function Row({ s, k, v, alert }: { s: any; k: string; v: string; alert?: boolean }) {
  return (
    <View style={s.row}>
      <Text style={s.rowKey}>{k}</Text>
      <Text style={[s.rowVal, alert && s.alertText]}>{v}</Text>
    </View>
  );
}

const createStyles = (theme: ReturnType<typeof useV3Theme>) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: theme.background },
    content: { padding: v3Spacing.medium, gap: v3Spacing.medium },
    card: { width: '100%' },
    title: { color: theme.text, fontSize: v3Type.title, fontWeight: '700', marginBottom: v3Spacing.small },
    sectionTitle: { color: theme.text, fontSize: v3Type.subtitle, fontWeight: '700', marginBottom: v3Spacing.small },
    warn: { color: theme.mutedText, fontSize: v3Type.caption, marginBottom: v3Spacing.small, lineHeight: 18 },
    pathText: { color: theme.mutedText, fontSize: v3Type.caption, marginTop: v3Spacing.small },
    planBox: { marginTop: v3Spacing.medium, gap: 4 },
    row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
    rowKey: { color: theme.mutedText, fontSize: v3Type.body },
    rowVal: { color: theme.text, fontSize: v3Type.body, fontWeight: '600', flexShrink: 1, textAlign: 'right' },
    alertText: { color: '#e5484d', fontSize: v3Type.caption, marginTop: 4 },
    phaseText: { color: theme.text, fontSize: v3Type.body },
    hint: { color: theme.mutedText, fontSize: v3Type.caption, marginTop: 4 },
  });
