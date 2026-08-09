import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import {
  runFirmwareCheck, downloadFirmware, BackupState,
} from '../services/FirmwareBackupService';
import { t } from '../i18n';
import { useV3Theme } from '../theme/v3';
import { Button, Section, StatusLine, WarningNote } from '../components/ui/primitives';

/*
 * v2.3.2 beta — Ambit firmware backup screen.
 *
 * BACKUP ONLY, always shown up front: the downloaded file is Suunto's real
 * proprietary firmware container (starts with an "SFI2" magic, not a real
 * zip despite the name — confirmed against a real download), and there is no
 * known way to flash it back onto the watch from this app. This screen can
 * only read what Suunto's own update-check service reports and save that
 * file untouched, for safekeeping — same spirit as e.g. Settings' "About"
 * disclaimer, but load-bearing here since a user could otherwise assume
 * "backup" implies "restore".
 */

export default function BackupScreen() {
  const theme = useV3Theme();
  const styles = createStyles(theme);

  const [state, setState] = useState<BackupState>({ phase: 'idle' });
  const [downloadPct, setDownloadPct] = useState(0);
  const [downloadedTo, setDownloadedTo] = useState<string | undefined>();
  const [downloadError, setDownloadError] = useState<string | undefined>();
  const [downloading, setDownloading] = useState(false);

  const busy = state.phase === 'connecting' || state.phase === 'reading' ||
    state.phase === 'checking' || downloading;

  async function handleCheck() {
    if (busy) return;
    setDownloadedTo(undefined);
    setDownloadError(undefined);
    await runFirmwareCheck(setState);
  }

  async function handleDownload() {
    if (busy || !state.deviceInfo || !state.firmwareInfo?.downloadUri) return;
    setDownloading(true);
    setDownloadPct(0);
    setDownloadError(undefined);
    try {
      const path = await downloadFirmware(
        state.firmwareInfo.downloadUri,
        state.deviceInfo.model,
        state.firmwareInfo.latestFirmwareVersion ?? 'unknown',
        (received, total) => setDownloadPct(total > 0 ? Math.round((received / total) * 100) : 0)
      );
      setDownloadedTo(path);
    } catch (e: any) {
      if (e?.code === 'SAVE_AS_CANCELLED') { setDownloading(false); return; } // not an error — user just backed out of the picker
      setDownloadError(e?.message ?? t.unknownError);
    } finally {
      setDownloading(false);
    }
  }

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>

      <WarningNote>{t.backupWarning}</WarningNote>

      {/* ── Check available firmware ── */}
      <Section title={t.backupCheckSection} description={t.backupCheckDesc} style={{ marginTop: 16 }}>
        <View style={styles.row}>
          <Button
            label={t.backupCheckBtn}
            variant="filled"
            loading={state.phase === 'connecting' || state.phase === 'reading' || state.phase === 'checking'}
            disabled={busy}
            onPress={handleCheck}
          />
        </View>

        {state.phase === 'reading' && <StatusLine text={t.backupReading} />}
        {state.phase === 'checking' && <StatusLine text={t.backupChecking} />}
        {state.phase === 'error' && <StatusLine text={state.error ?? t.error} tone="alert" />}

        {state.phase === 'done' && state.deviceInfo && (
          <View style={styles.deviceInfoBox}>
            <Text style={styles.deviceInfoPrimary}>
              {state.deviceInfo.name} — {state.deviceInfo.fwVersion}
            </Text>
            <Text style={styles.deviceInfoSecondary}>{state.deviceInfo.model} / {state.deviceInfo.hwVersion}</Text>
          </View>
        )}

        {state.phase === 'done' && state.firmwareInfo && (
          state.firmwareInfo.latestFirmwareVersion ? (
            <View style={styles.deviceInfoBox}>
              <Text style={styles.deviceInfoPrimary}>{t.backupLatestVersion(state.firmwareInfo.latestFirmwareVersion)}</Text>
              {!!state.firmwareInfo.uploadDate && (
                <Text style={styles.deviceInfoSecondary}>{t.backupUploadDate(state.firmwareInfo.uploadDate)}</Text>
              )}
            </View>
          ) : (
            <StatusLine text={t.backupNoUpdateInfo} tone="alert" />
          )
        )}
      </Section>

      {/* ── Download backup ── */}
      {state.phase === 'done' && state.firmwareInfo?.downloadUri && (
        <Section title={t.backupDownloadSection} description={t.backupDownloadDesc}>
          <View style={styles.row}>
            <Button label={t.backupDownloadBtn} variant="filled" loading={downloading} disabled={busy} onPress={handleDownload} />
          </View>

          {downloading && <StatusLine text={t.backupDownloading(downloadPct)} />}
          {!!downloadedTo && <StatusLine text={t.backupDownloadDone} />}
          {!!downloadError && <StatusLine text={downloadError} tone="alert" />}
        </Section>
      )}

    </ScrollView>
  );
}

const createStyles = (t: ReturnType<typeof useV3Theme>) => StyleSheet.create({
  root: { flex: 1, backgroundColor: t.background },
  content: { padding: 20 },
  row: { flexDirection: 'row', gap: 10, marginTop: 4 },
  deviceInfoBox: { marginTop: 14, paddingTop: 14, borderTopWidth: 1, borderTopColor: t.mutedText + '33' },
  deviceInfoPrimary: { color: t.text, fontSize: 15, fontWeight: '600', marginBottom: 4 },
  deviceInfoSecondary: { color: t.mutedText, fontSize: 12, marginBottom: 2 },
});
