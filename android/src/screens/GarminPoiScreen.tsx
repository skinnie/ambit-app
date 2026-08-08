import React, { useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator,
} from 'react-native';
import { useRoute, RouteProp } from '@react-navigation/native';
import * as Garmin from '../native/GarminModule';
import { pickGpxFile, shareFile } from '../native/AmbitUsbModule';
import { exportGarminGpxFiles, isGarminWaypointFile, GarminGpxExportResult, GarminGpxExportState } from '../services/GarminGpxExportService';
import RNFS from 'react-native-fs';
import { t } from '../i18n';
import type { RootStackParamList } from '../../App';

/*
 * v2.3.2 beta — mirrors the Ambit PoiScreen's structure (send / retrieve),
 * split out from the old combined GarminScreen per André's feedback: "today
 * we have the same page as routes. It is non ok. Just like the suunto
 * counterpart, it should send a poi from gpx ... or retrieve the POIs from
 * the device." Unlike the Ambit3, Garmin has no separate manual-entry POI
 * protocol — POIs are plain GPX-waypoint files (BaseCamp's "Waypoints*.gpx"
 * naming, confirmed on real hardware), so this screen has no manual-entry
 * form. The device is already connected by HomeScreen's connecting-flow —
 * no Connect step here.
 */

type SendState = 'idle' | 'picking' | 'uploading' | 'done' | 'error';

export default function GarminPoiScreen() {
  const route = useRoute<RouteProp<RootStackParamList, 'GarminPoi'>>();
  const info = route.params.info;
  const sdCardVolume = info.volumes.find(v => !v.hasGarminDeviceXml);

  const [sendState, setSendState] = useState<SendState>('idle');
  const [sendError, setSendError] = useState<string | undefined>();

  const [retrieveState, setRetrieveState] = useState<GarminGpxExportState>({ phase: 'idle' });
  const [retrievedFiles, setRetrievedFiles] = useState<GarminGpxExportResult[]>([]);

  const busy = sendState === 'picking' || sendState === 'uploading' || retrieveState.phase === 'reading';

  async function handleSendPoi() {
    if (busy || !sdCardVolume) return;
    setSendState('picking');
    setSendError(undefined);
    try {
      const localPath = await pickGpxFile();
      setSendState('uploading');
      const content = await RNFS.readFile(localPath, 'utf8');
      const fileName = localPath.split('/').pop() ?? `poi_${Date.now()}.gpx`;
      await Garmin.writeGpxToSdCard(sdCardVolume.volumeIndex, fileName, content);
      setSendState('done');
    } catch (e: any) {
      if (e?.code === 'GPX_PICK_CANCELLED') { setSendState('idle'); return; }
      setSendState('error');
      setSendError(`${e?.code ?? ''} ${e?.message ?? t.unknownError}`.trim());
    }
  }

  async function handleRetrievePois() {
    if (busy) return;
    setRetrievedFiles([]);
    const results = await exportGarminGpxFiles(info, isGarminWaypointFile, setRetrieveState);
    setRetrievedFiles(results);
  }

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>

      {/* ── Send a POI to the device (SD card only) ── */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t.garminPoiSendSection}</Text>
        <Text style={styles.sectionDesc}>{t.garminPoiSendDesc}</Text>

        <View style={styles.warningBox}>
          <Text style={styles.warningText}>{t.garminInternalMemoryWarning}</Text>
        </View>

        <View style={styles.row}>
          <TouchableOpacity
            style={[styles.btn, styles.btnPrimary, (busy || !sdCardVolume) && styles.btnDisabled]}
            onPress={handleSendPoi}
            disabled={busy || !sdCardVolume}
          >
            {(sendState === 'picking' || sendState === 'uploading')
              ? <ActivityIndicator size="small" color="#fff" />
              : <Text style={styles.btnText}>{t.garminPoiSendBtn}</Text>
            }
          </TouchableOpacity>
        </View>

        {!sdCardVolume && (
          <View style={styles.statusRow}>
            <View style={[styles.dot, styles.dotError]} />
            <Text style={[styles.statusText, styles.statusTextError]}>{t.garminNoSdCardMsg}</Text>
          </View>
        )}
        {sendState === 'done' && (
          <View style={styles.statusRow}>
            <View style={styles.dot} />
            <Text style={styles.statusText}>{t.garminPoiSendDone}</Text>
          </View>
        )}
        {sendState === 'error' && (
          <View style={styles.statusRow}>
            <View style={[styles.dot, styles.dotError]} />
            <Text style={[styles.statusText, styles.statusTextError]}>{sendError}</Text>
          </View>
        )}
      </View>

      {/* ── Retrieve POIs from the device to Downloads ── */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t.garminPoiRetrieveSection}</Text>
        <Text style={styles.sectionDesc}>{t.garminPoiRetrieveDesc}</Text>

        <View style={styles.row}>
          <TouchableOpacity
            style={[styles.btn, styles.btnOrange, busy && styles.btnDisabled]}
            onPress={handleRetrievePois}
            disabled={busy}
          >
            {retrieveState.phase === 'reading'
              ? <ActivityIndicator size="small" color="#fff" />
              : <Text style={styles.btnText}>{t.garminPoiRetrieveBtn}</Text>
            }
          </TouchableOpacity>
        </View>

        {retrieveState.phase === 'error' && (
          <View style={styles.statusRow}>
            <View style={[styles.dot, styles.dotError]} />
            <Text style={[styles.statusText, styles.statusTextError]}>{retrieveState.error}</Text>
          </View>
        )}
        {retrieveState.phase === 'done' && (
          <View style={styles.statusRow}>
            <View style={styles.dot} />
            <Text style={styles.statusText}>{t.garminPoiRetrieveDone(retrievedFiles.length)}</Text>
          </View>
        )}
        {retrievedFiles.map(f => (
          <View key={f.localPath} style={styles.exportedRow}>
            <Text style={styles.exportedFileName} numberOfLines={1}>{f.fileName}</Text>
            <TouchableOpacity onPress={() => shareFile(f.localPath).catch(() => {})}>
              <Text style={styles.shareLink}>{t.garminShareBtn}</Text>
            </TouchableOpacity>
          </View>
        ))}
      </View>

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
  sectionTitle: { fontSize: 17, fontWeight: '700', color: '#00a651', marginBottom: 8 },
  sectionDesc: { fontSize: 13, color: '#8899aa', marginBottom: 6, lineHeight: 19 },
  row: { flexDirection: 'row', gap: 10, marginTop: 12 },
  btn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnPrimary: { backgroundColor: '#00a65122', borderWidth: 1, borderColor: '#00a651' },
  btnOrange:  { backgroundColor: '#fc4c0222', borderWidth: 1, borderColor: '#fc4c02' },
  btnDisabled: { opacity: 0.5 },
  btnText: { color: '#fff', fontWeight: '600', fontSize: 14 },
  statusRow: { flexDirection: 'row', alignItems: 'center', marginTop: 10 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#4caf50', marginRight: 6 },
  dotError: { backgroundColor: '#ff5252' },
  statusText: { color: '#4caf50', fontSize: 12, flex: 1 },
  statusTextError: { color: '#ff5252', flex: 1 },
  warningBox: {
    backgroundColor: '#ffb30022', borderWidth: 1, borderColor: '#ffb300',
    borderRadius: 8, padding: 10, marginTop: 8,
  },
  warningText: { color: '#ffb300', fontSize: 12, lineHeight: 17 },
  exportedRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: '#1a1a2e',
  },
  exportedFileName: { color: '#8ab4d8', fontSize: 12, flex: 1, marginRight: 10 },
  shareLink: { color: '#00e5ff', fontSize: 12, fontWeight: '600' },
});
