import React, { useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator,
} from 'react-native';
import {
  runFirmwareCheck, downloadFirmware, BackupState,
} from '../services/FirmwareBackupService';
import { t } from '../i18n';

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

      <View style={styles.warningBox}>
        <Text style={styles.warningText}>{t.backupWarning}</Text>
      </View>

      {/* ── Check available firmware ── */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t.backupCheckSection}</Text>
        <Text style={styles.sectionDesc}>{t.backupCheckDesc}</Text>

        <View style={styles.row}>
          <TouchableOpacity
            style={[styles.btn, styles.btnPrimary, busy && styles.btnDisabled]}
            onPress={handleCheck}
            disabled={busy}
          >
            {(state.phase === 'connecting' || state.phase === 'reading' || state.phase === 'checking')
              ? <ActivityIndicator size="small" color="#fff" />
              : <Text style={styles.btnText}>{t.backupCheckBtn}</Text>
            }
          </TouchableOpacity>
        </View>

        {state.phase === 'reading' && (
          <View style={styles.statusRow}>
            <View style={styles.dot} />
            <Text style={styles.statusText}>{t.backupReading}</Text>
          </View>
        )}
        {state.phase === 'checking' && (
          <View style={styles.statusRow}>
            <View style={styles.dot} />
            <Text style={styles.statusText}>{t.backupChecking}</Text>
          </View>
        )}
        {state.phase === 'error' && (
          <View style={styles.statusRow}>
            <View style={[styles.dot, styles.dotError]} />
            <Text style={[styles.statusText, styles.statusTextError]}>{state.error}</Text>
          </View>
        )}

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
            <View style={styles.statusRow}>
              <View style={[styles.dot, styles.dotError]} />
              <Text style={[styles.statusText, styles.statusTextError]}>{t.backupNoUpdateInfo}</Text>
            </View>
          )
        )}
      </View>

      {/* ── Download backup ── */}
      {state.phase === 'done' && state.firmwareInfo?.downloadUri && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t.backupDownloadSection}</Text>
          <Text style={styles.sectionDesc}>{t.backupDownloadDesc}</Text>

          <View style={styles.row}>
            <TouchableOpacity
              style={[styles.btn, styles.btnPrimary, busy && styles.btnDisabled]}
              onPress={handleDownload}
              disabled={busy}
            >
              {downloading
                ? <ActivityIndicator size="small" color="#fff" />
                : <Text style={styles.btnText}>{t.backupDownloadBtn}</Text>
              }
            </TouchableOpacity>
          </View>

          {downloading && (
            <View style={styles.statusRow}>
              <View style={styles.dot} />
              <Text style={styles.statusText}>{t.backupDownloading(downloadPct)}</Text>
            </View>
          )}
          {!!downloadedTo && (
            <View style={styles.statusRow}>
              <View style={styles.dot} />
              <Text style={styles.statusText}>{t.backupDownloadDone}</Text>
            </View>
          )}
          {!!downloadError && (
            <View style={styles.statusRow}>
              <View style={[styles.dot, styles.dotError]} />
              <Text style={[styles.statusText, styles.statusTextError]}>{downloadError}</Text>
            </View>
          )}
        </View>
      )}

    </ScrollView>
  );
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
  btnDisabled: { opacity: 0.5 },
  btnText: { color: '#fff', fontWeight: '600', fontSize: 14 },
  statusRow: { flexDirection: 'row', alignItems: 'center', marginTop: 10 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#4caf50', marginRight: 6 },
  dotError: { backgroundColor: '#ff5252' },
  statusText: { color: '#4caf50', fontSize: 12, flex: 1 },
  statusTextError: { color: '#ff5252', flex: 1 },
  deviceInfoBox: { marginTop: 14, paddingTop: 14, borderTopWidth: 1, borderTopColor: '#1a1a2e' },
  deviceInfoPrimary: { color: '#fff', fontSize: 15, fontWeight: '600', marginBottom: 4 },
  deviceInfoSecondary: { color: '#8899aa', fontSize: 12, marginBottom: 2 },
  warningBox: {
    backgroundColor: '#ffb30022', borderWidth: 1, borderColor: '#ffb300',
    borderRadius: 8, padding: 14, marginBottom: 20,
  },
  warningText: { color: '#ffb300', fontSize: 13, lineHeight: 18 },
});
