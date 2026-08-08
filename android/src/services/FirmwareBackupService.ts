import RNFS from 'react-native-fs';
import { connect, disconnect, getDeviceInfo, AmbitDeviceInfo, saveFileAs } from '../native/AmbitUsbModule';

// Suunto's live device-info service — same unauthenticated host as the GPS orbital
// endpoint (see SgeeService.ts), confirmed working 2026-08-07 against a real
// connected watch (see V3_CHANGELOG.md / tools/firmware_check.py in the companion
// research project). `model` here is the watch's own raw model-field string from
// its device-info reply (e.g. "Emu" — a codename, not a marketing name), not looked
// up from any table — the API expects exactly that string.
const FIRMWARE_CHECK_BASE = 'https://devices.suunto-operations.com/devices';
const FIRMWARE_APP_KEY = 'DbCBVqja20NKdrimBHQxtYIdczUJ56WHIWlC6A7vp6NPC0D0a8wA5d0ODyywFKe6';

export interface FirmwareCheckResult {
  latestFirmwareVersion: string | null;
  uploadDate: string | null;
  releaseType: string | null;
  downloadUri: string | null;
}

export async function checkFirmware(model: string, hwVersion: string): Promise<FirmwareCheckResult> {
  const url = `${FIRMWARE_CHECK_BASE}/${encodeURIComponent(model)}/${encodeURIComponent(hwVersion)}?appkey=${FIRMWARE_APP_KEY}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Firmware check failed: HTTP ${res.status}`);
  }
  const json = await res.json();
  return {
    latestFirmwareVersion: json.LatestFirmwareVersion ?? null,
    uploadDate: json.FirmwareUploadDate ?? null,
    releaseType: json.ReleaseType ?? null,
    downloadUri: json.LatestFirmwareURI ?? null,
  };
}

/**
 * Downloads the firmware container to a temp path, then lets the user pick
 * exactly where to keep it via the system "Save as" picker — defaulting to
 * Downloads if they just accept the picker's suggestion (see saveFileAs() /
 * André's v2.3.3 feedback: "should ask on which folder we would like to
 * save, being the default one the downloads folder"). Despite the .zip-
 * looking name, this is NOT a standard zip archive — confirmed 2026-08-07
 * against a real download, it starts with an "SFI2" magic and looks
 * proprietary/encrypted. This is a BACKUP ONLY: there is no known way to
 * flash it back onto the watch from here. Only Suunto's own official app/
 * SuuntoLink can install firmware.
 *
 * @returns the content:// URI the user saved to (SAVE_AS_CANCELLED rejects
 *   if they back out of the picker — the download itself already succeeded).
 */
export async function downloadFirmware(
  downloadUri: string,
  model: string,
  version: string,
  onProgress?: (received: number, total: number) => void
): Promise<string> {
  const suggestedName = `${model}_${version}_firmware.bin`;
  const tempPath = `${RNFS.CachesDirectoryPath}/${suggestedName}`;

  const download = RNFS.downloadFile({
    fromUrl: downloadUri,
    toFile: tempPath,
    progress: onProgress ? (res) => onProgress(res.bytesWritten, res.contentLength) : undefined,
  });

  const result = await download.promise;
  if (result.statusCode !== 200) {
    throw new Error(`Firmware download failed: HTTP ${result.statusCode}`);
  }

  return saveFileAs(tempPath, suggestedName, 'application/octet-stream');
}

export interface BackupState {
  phase: 'idle' | 'connecting' | 'reading' | 'checking' | 'downloading' | 'done' | 'error';
  deviceInfo?: AmbitDeviceInfo;
  firmwareInfo?: FirmwareCheckResult;
  downloadedTo?: string;
  error?: string;
}

/** connect → read device info → check firmware, then disconnect (the watch isn't
 * needed for the download step itself, only to learn model/hwVersion). */
export async function runFirmwareCheck(onState: (s: BackupState) => void): Promise<void> {
  onState({ phase: 'connecting' });
  try {
    await connect();
  } catch (e: any) {
    onState({ phase: 'error', error: e?.message ?? 'Watch connection failed' });
    return;
  }

  let deviceInfo: AmbitDeviceInfo;
  try {
    onState({ phase: 'reading' });
    deviceInfo = await getDeviceInfo();
  } catch (e: any) {
    onState({ phase: 'error', error: e?.message ?? 'Failed to read device info' });
    await disconnect().catch(() => {});
    return;
  }

  await disconnect().catch(() => {});

  try {
    onState({ phase: 'checking', deviceInfo });
    const firmwareInfo = await checkFirmware(deviceInfo.model, deviceInfo.hwVersion);
    onState({ phase: 'done', deviceInfo, firmwareInfo });
  } catch (e: any) {
    onState({ phase: 'error', deviceInfo, error: e?.message ?? 'Firmware check failed' });
  }
}
