import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Alert, ScrollView } from 'react-native';
import { useV3Theme, v3Spacing, v3Type } from '../theme/v3';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/primitives';
import { connect, disconnect, firmwareFlash, onFirmwarePhase } from '../native/AmbitUsbModule';
import { checkFirmware, downloadFirmware, FirmwareCheck } from '../services/FirmwareService';

// SuuntoLink-style automatic firmware update. On open it detects the connected watch and asks
// Suunto's own firmware service for the latest image for that model+hardware. "Stream only"
// downloads + streams the image but STOPS before the irreversible commit (recoverable — the
// watch stays in BSL); "Flash" commits. The flash transport (firmware_flash_android.c) is a
// faithful port of the desktop's hardware-proven flasher; the opcode sequence is byte-exact
// against the real Traverse capture, but the Android transport itself is validated here first
// on hardware (stream-only) before committing.

export default function FirmwareScreen() {
  const theme = useV3Theme();
  const s = createStyles(theme);
  const [chk, setChk] = useState<FirmwareCheck | null>(null);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<string>('');
  const [error, setError] = useState<string>('');

  useEffect(() => onFirmwarePhase(e => setPhase(`${e.phase}: ${e.message}`)), []);
  useEffect(() => { runCheck(); }, []); // auto-detect + check on open

  async function runCheck() {
    setBusy(true); setError(''); setPhase('');
    try {
      setChk(await checkFirmware());
    } catch (e: any) {
      setError(e?.message ?? 'firmware check failed');
    } finally {
      setBusy(false);
    }
  }

  const battery = chk?.battery ?? -1;
  const batteryLow = battery >= 0 && battery < 30;
  const upToDate = !!chk && !!chk.currentFw && chk.currentFw === chk.latestVersion;

  async function downloadAndFlash(commit: boolean) {
    if (!chk?.downloadUrl) return;
    setBusy(true); setError(''); setPhase('download: fetching firmware…');
    try {
      const path = await downloadFirmware(chk.downloadUrl);
      await connect();
      await firmwareFlash(path, commit, true /* confirm */);
      Alert.alert(commit ? 'Flash complete' : 'Stream complete',
        commit ? 'The watch rebooted with the firmware. Verify it powers up normally.'
               : 'Streamed the whole image without committing. The watch is in BSL — recoverable: run Flash to finish, or power-cycle.');
    } catch (e: any) {
      setError(e?.message ?? 'flash failed');
      Alert.alert('Flash error',
        `${e?.message ?? 'error'}\n\nIf the watch is stuck in BSL it is recoverable: re-run Flash, or re-flash with SuuntoLink on Windows.`);
    } finally {
      await disconnect().catch(() => {});
      setBusy(false);
    }
  }

  function confirmStreamOnly() {
    Alert.alert('Stream only (recoverable test)',
      'Downloads the firmware, enters the bootloader and streams the whole image but STOPS ' +
      'before committing. The watch is left in BSL and is fully recoverable. Keep the USB cable still. Proceed?',
      [{ text: 'Cancel', style: 'cancel' }, { text: 'Stream', onPress: () => downloadAndFlash(false) }]);
  }

  function confirmCommit() {
    Alert.alert('⚠ Flash firmware',
      `Downloads and writes firmware ${chk?.latestVersion} to the ${chk?.model}, then reboots it. ` +
      'An interruption can brick the watch (recoverable via SuuntoLink). Keep the cable still. Proceed?',
      [{ text: 'Cancel', style: 'cancel' },
       { text: 'Flash now', style: 'destructive', onPress: () => downloadAndFlash(true) }]);
  }

  return (
    <ScrollView style={s.root} contentContainerStyle={s.content}>
      <Card style={s.card}>
        <Text style={s.title}>Firmware</Text>
        <Text style={s.warn}>
          Detects the watch and fetches the matching firmware from Suunto automatically.
          Use “Stream only” first (recoverable) to validate, then “Flash”.
        </Text>
        <Button label="Detect & check" icon="sync" onPress={runCheck} loading={busy} disabled={busy} />
        {!!error && <Text style={s.alertText}>{error}</Text>}
      </Card>

      {!!chk && (
        <Card style={s.card}>
          <Text style={s.sectionTitle}>{chk.model || 'Watch'}</Text>
          <Row s={s} k="Serial" v={chk.serial || '—'} />
          <Row s={s} k="Hardware" v={chk.hwVersion || '—'} />
          <Row s={s} k="Current firmware" v={chk.currentFw || '—'} />
          <Row s={s} k="Latest available" v={`${chk.latestVersion || '—'}${chk.releaseType ? ` (${chk.releaseType})` : ''}`} />
          <Row s={s} k="Battery" v={battery >= 0 ? `${battery}%` : '—'} alert={batteryLow} />
          {upToDate && <Text style={s.okText}>Already on the latest firmware. Re-flashing installs the same version (safe).</Text>}
          {batteryLow && <Text style={s.alertText}>Battery under 30% — charge before flashing.</Text>}
        </Card>
      )}

      {!!chk?.downloadUrl && (
        <Card style={s.card}>
          <Text style={s.sectionTitle}>Update</Text>
          <Text style={s.warn}>Downloads firmware {chk.latestVersion} and writes it over USB. Keep the cable still.</Text>
          <Button label="Stream only (safe, recoverable)" icon="upload" variant="outline"
            onPress={confirmStreamOnly} disabled={busy || batteryLow} loading={busy} />
          <View style={{ height: v3Spacing.small }} />
          <Button label={`Flash ${chk.latestVersion} (commit)`} icon="warning" tone="alert"
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
    row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
    rowKey: { color: theme.mutedText, fontSize: v3Type.body },
    rowVal: { color: theme.text, fontSize: v3Type.body, fontWeight: '600', flexShrink: 1, textAlign: 'right' },
    alertText: { color: '#e5484d', fontSize: v3Type.caption, marginTop: 4 },
    okText: { color: '#30a46c', fontSize: v3Type.caption, marginTop: 4 },
    phaseText: { color: theme.text, fontSize: v3Type.body },
    hint: { color: theme.mutedText, fontSize: v3Type.caption, marginTop: 4 },
  });
