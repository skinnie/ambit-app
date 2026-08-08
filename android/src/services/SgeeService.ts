import RNFS from 'react-native-fs';
import { updateSgee } from '../native/AmbitUsbModule';

// URL du fichier SGEE Suunto (éphémérides GPS, mis à jour hebdomadairement)
// Source : API publique Suunto, même endpoint qu'Openambit
const SGEE_URL = 'https://uiservices.suunto.com/api/sgee/v1/fetch';
const SGEE_LOCAL_PATH = `${RNFS.DocumentDirectoryPath}/sgee.bin`;

export interface SgeeStatus {
  localExists: boolean;
  localDate: Date | null;
  isExpired: boolean;   // > 7 jours
}

/** Vérifie l'état du fichier SGEE local. */
export async function getSgeeStatus(): Promise<SgeeStatus> {
  const exists = await RNFS.exists(SGEE_LOCAL_PATH);
  if (!exists) return { localExists: false, localDate: null, isExpired: true };

  const stat = await RNFS.stat(SGEE_LOCAL_PATH);
  const localDate = new Date(stat.mtime);
  const ageMs = Date.now() - localDate.getTime();
  const isExpired = ageMs > 7 * 24 * 60 * 60 * 1000; // 7 jours

  return { localExists: true, localDate, isExpired };
}

/**
 * Télécharge le fichier SGEE depuis les serveurs Suunto et l'enregistre localement.
 * @param onProgress Callback optionnel (bytes reçus / total)
 */
export async function downloadSgee(
  onProgress?: (received: number, total: number) => void
): Promise<void> {
  const download = RNFS.downloadFile({
    fromUrl: SGEE_URL,
    toFile: SGEE_LOCAL_PATH,
    headers: {
      'User-Agent': 'OpenSportsSync/1.0',
      'Accept': 'application/octet-stream',
    },
    progress: onProgress
      ? (res) => onProgress(res.bytesWritten, res.contentLength)
      : undefined,
  });

  const result = await download.promise;
  if (result.statusCode !== 200) {
    throw new Error(`Téléchargement SGEE échoué : HTTP ${result.statusCode}`);
  }
}

/**
 * Télécharge le SGEE si nécessaire, puis l'envoie à la montre.
 * La montre doit être déjà connectée (connect() appelé avant).
 * @param forceDownload Forcer le re-téléchargement même si le fichier est récent
 * @param onProgress    Callback de progression du téléchargement
 */
export async function updateWatchSgee(
  forceDownload = false,
  onProgress?: (received: number, total: number) => void
): Promise<void> {
  const status = await getSgeeStatus();

  if (forceDownload || status.isExpired || !status.localExists) {
    await downloadSgee(onProgress);
  }

  await updateSgee(SGEE_LOCAL_PATH);
}
