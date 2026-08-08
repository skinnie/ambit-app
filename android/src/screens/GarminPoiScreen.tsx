import React, { useState } from 'react';
import { StyleSheet, ScrollView, View } from 'react-native';
import { useRoute, RouteProp } from '@react-navigation/native';
import * as Garmin from '../native/GarminModule';
import { pickGpxFile, shareFile } from '../native/AmbitUsbModule';
import { exportGarminGpxFiles, isGarminWaypointFile, GarminGpxExportResult, GarminGpxExportState } from '../services/GarminGpxExportService';
import RNFS from 'react-native-fs';
import { t } from '../i18n';
import type { RootStackParamList } from '../../App';
import { useTheme } from '../theme/useTheme';
import { Button, ExportedFileRow, Section, StatusLine, WarningNote } from '../components/ui/primitives';

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
  const theme = useTheme();
  const styles = createStyles(theme);
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
      <Section title={t.garminPoiSendSection} description={t.garminPoiSendDesc}>
        <WarningNote>{t.garminInternalMemoryWarning}</WarningNote>

        <View style={styles.row}>
          <Button
            label={t.garminPoiSendBtn}
            variant="filled"
            loading={sendState === 'picking' || sendState === 'uploading'}
            disabled={busy || !sdCardVolume}
            onPress={handleSendPoi}
          />
        </View>

        {!sdCardVolume && <StatusLine text={t.garminNoSdCardMsg} tone="alert" />}
        {sendState === 'done' && <StatusLine text={t.garminPoiSendDone} />}
        {sendState === 'error' && <StatusLine text={sendError ?? t.error} tone="alert" />}
      </Section>

      {/* ── Retrieve POIs from the device to Downloads ── */}
      <Section title={t.garminPoiRetrieveSection} description={t.garminPoiRetrieveDesc}>
        <View style={styles.row}>
          <Button
            label={t.garminPoiRetrieveBtn}
            variant="outline"
            loading={retrieveState.phase === 'reading'}
            disabled={busy}
            onPress={handleRetrievePois}
          />
        </View>

        {retrieveState.phase === 'error' && <StatusLine text={retrieveState.error ?? t.error} tone="alert" />}
        {retrieveState.phase === 'done' && <StatusLine text={t.garminPoiRetrieveDone(retrievedFiles.length)} />}
        {retrievedFiles.map(f => (
          <ExportedFileRow
            key={f.localPath}
            fileName={f.fileName}
            shareLabel={t.garminShareBtn}
            onShare={() => shareFile(f.localPath).catch(() => {})}
          />
        ))}
      </Section>

    </ScrollView>
  );
}

const createStyles = (t: ReturnType<typeof useTheme>) => StyleSheet.create({
  root: { flex: 1, backgroundColor: t.background },
  content: { padding: 20 },
  row: { flexDirection: 'row', gap: 10, marginTop: 10 },
});
