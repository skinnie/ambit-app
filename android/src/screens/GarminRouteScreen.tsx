import React, { useState } from 'react';
import { StyleSheet, ScrollView, View } from 'react-native';
import { useRoute, RouteProp } from '@react-navigation/native';
import * as Garmin from '../native/GarminModule';
import { pickGpxFile, shareFile } from '../native/AmbitUsbModule';
import { exportGarminGpxFiles, isGarminRouteFile, GarminGpxExportResult, GarminGpxExportState } from '../services/GarminGpxExportService';
import RNFS from 'react-native-fs';
import { t } from '../i18n';
import type { RootStackParamList } from '../../App';
import { useTheme } from '../theme/useTheme';
import { Button, ExportedFileRow, Section, StatusLine, WarningNote } from '../components/ui/primitives';

/*
 * v2.3.2 beta — mirrors the Ambit RouteScreen's structure (send / export),
 * split out from the old combined GarminScreen per André's feedback: "just
 * like the suunto counterpart, the menu should only show send a route (like
 * it does today) and export from the gps ... to by default downloads
 * folder, with ability to choose." The device is already connected by
 * HomeScreen's connecting-flow — no Connect step here.
 */

type SendState = 'idle' | 'picking' | 'uploading' | 'done' | 'error';

export default function GarminRouteScreen() {
  const theme = useTheme();
  const styles = createStyles(theme);
  const route = useRoute<RouteProp<RootStackParamList, 'GarminRoute'>>();
  const info = route.params.info;
  const sdCardVolume = info.volumes.find(v => !v.hasGarminDeviceXml);

  const [sendState, setSendState] = useState<SendState>('idle');
  const [sendError, setSendError] = useState<string | undefined>();

  const [exportState, setExportState] = useState<GarminGpxExportState>({ phase: 'idle' });
  const [exportedFiles, setExportedFiles] = useState<GarminGpxExportResult[]>([]);

  const busy = sendState === 'picking' || sendState === 'uploading' || exportState.phase === 'reading';

  async function handleSendRoute() {
    if (busy || !sdCardVolume) return;
    setSendState('picking');
    setSendError(undefined);
    try {
      const localPath = await pickGpxFile();
      setSendState('uploading');
      const content = await RNFS.readFile(localPath, 'utf8');
      const fileName = localPath.split('/').pop() ?? `route_${Date.now()}.gpx`;
      await Garmin.writeGpxToSdCard(sdCardVolume.volumeIndex, fileName, content);
      setSendState('done');
    } catch (e: any) {
      if (e?.code === 'GPX_PICK_CANCELLED') { setSendState('idle'); return; }
      setSendState('error');
      setSendError(`${e?.code ?? ''} ${e?.message ?? t.unknownError}`.trim());
    }
  }

  async function handleExportRoutes() {
    if (busy) return;
    setExportedFiles([]);
    const results = await exportGarminGpxFiles(info, isGarminRouteFile, setExportState);
    setExportedFiles(results);
  }

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>

      {/* ── Send a route to the device (SD card only) ── */}
      <Section title={t.garminRouteSendSection} description={t.garminRouteSendDesc}>
        <WarningNote>{t.garminInternalMemoryWarning}</WarningNote>

        <View style={styles.row}>
          <Button
            label={t.garminRouteSendBtn}
            variant="filled"
            loading={sendState === 'picking' || sendState === 'uploading'}
            disabled={busy || !sdCardVolume}
            onPress={handleSendRoute}
          />
        </View>

        {!sdCardVolume && <StatusLine text={t.garminNoSdCardMsg} tone="alert" />}
        {sendState === 'done' && <StatusLine text={t.garminRouteSendDone} />}
        {sendState === 'error' && <StatusLine text={sendError ?? t.error} tone="alert" />}
      </Section>

      {/* ── Export routes/tracks from the device to Downloads ── */}
      <Section title={t.garminRouteExportSection} description={t.garminRouteExportDesc}>
        <View style={styles.row}>
          <Button
            label={t.garminRouteExportBtn}
            variant="outline"
            loading={exportState.phase === 'reading'}
            disabled={busy}
            onPress={handleExportRoutes}
          />
        </View>

        {exportState.phase === 'error' && <StatusLine text={exportState.error ?? t.error} tone="alert" />}
        {exportState.phase === 'done' && <StatusLine text={t.garminRouteExportDone(exportedFiles.length)} />}
        {exportedFiles.map(f => (
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
