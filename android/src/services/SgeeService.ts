import RNFS from 'react-native-fs';
import { connect, disconnect, updateSgee } from '../native/AmbitUsbModule';

// GPS orbital data (AGPS/SGEE) — live, unauthenticated Suunto endpoint.
// Verified working 2026-08-05 against real hardware: see ambit-app/sgee_andre.md
// and ambit-app/tools/README.md. NOT the same as the account-tied cloudapi.suunto.com
// host — this is devices.suunto-operations.com, found in SuuntoLink's own
// production.json, and it needs no AppKey/serial/account for this specific path.
// GLONASS is only relevant on Traverse/Traverse Alpha/Ambit3 Vertical, so only
// the GPS orbit file is fetched here.
const SGEE_URL = 'https://devices.suunto-operations.com/devices/gpsorbit/binary';
const SGEE_LOCAL_PATH = `${RNFS.DocumentDirectoryPath}/gpsorbit.bin`;

/**
 * Downloads the current GPS orbit file and writes it to the watch.
 * The watch must already be connected (connect() called before this).
 *
 * No local staleness/caching logic here on purpose: the download is small
 * (tens of KB) and fast, and the native write path (device_driver_ambit3.c's
 * gps_orbit_write) already compares the new data's embedded generation date
 * against what the watch currently holds and skips the actual flash write if
 * nothing changed — so a manual "update" tap can just always fetch fresh and
 * let that existing check decide whether anything really needs writing.
 */
export async function updateWatchSgee(
  onProgress?: (received: number, total: number) => void
): Promise<void> {
  const download = RNFS.downloadFile({
    fromUrl: SGEE_URL,
    toFile: SGEE_LOCAL_PATH,
    headers: {
      'User-Agent': 'AmbitApp/1.0',
      'Accept': 'application/octet-stream',
    },
    progress: onProgress
      ? (res) => onProgress(res.bytesWritten, res.contentLength)
      : undefined,
  });

  const result = await download.promise;
  if (result.statusCode !== 200) {
    throw new Error(`SGEE download failed: HTTP ${result.statusCode}`);
  }

  await updateSgee(SGEE_LOCAL_PATH);
}

export interface OrbitalUpdateState {
  phase: 'idle' | 'connecting' | 'downloading' | 'writing' | 'done' | 'error';
  error?: string;
}

/** Full pipeline for the HomeScreen button: connect, download, write, disconnect. */
export async function updateOrbitalData(onState: (s: OrbitalUpdateState) => void): Promise<void> {
  onState({ phase: 'connecting' });
  try {
    await connect();
  } catch (e: any) {
    onState({ phase: 'error', error: e?.message ?? 'Connexion à la montre échouée' });
    return;
  }

  onState({ phase: 'downloading' });
  try {
    await updateWatchSgee();
    onState({ phase: 'writing' }); // le téléchargement et l'écriture native sont rapides, phase surtout indicative
    onState({ phase: 'done' });
  } catch (e: any) {
    onState({ phase: 'error', error: e?.message ?? 'Échec de la mise à jour des données GPS' });
  } finally {
    await disconnect().catch(() => {});
  }
}
