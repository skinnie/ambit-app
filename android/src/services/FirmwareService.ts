import RNFS from 'react-native-fs';
import { connect, disconnect, getDeviceInfo } from '../native/AmbitUsbModule';
import { bytesToBase64 } from './Base64';

// SuuntoLink-style automatic firmware update: detect the connected watch, ask Suunto's own
// firmware service for the latest image for that model+hardware, and download it. The service
// + app key are the same the desktop's tools/firmware_check.py uses (confirmed live 2026-08-07,
// unauthenticated beyond the app key). The downloaded file is the SFI2ST container the flasher
// (firmware_flash_android.c) streams to the watch.

const BASE_URL = 'https://devices.suunto-operations.com/devices';
const APP_KEY = 'DbCBVqja20NKdrimBHQxtYIdczUJ56WHIWlC6A7vp6NPC0D0a8wA5d0ODyywFKe6';

// A watch in the bootloader reports its model as "BSL", but the USB product id still names the
// real model - so we map product id -> codename to fetch the right firmware even for a watch
// stuck in BSL (same trick the desktop's firmware_check.py uses). Codenames are what the
// Suunto firmware service expects.
const PID_CODENAME: Record<number, string> = {
  0x1b: 'Emu', 0x1c: 'Finch', 0x1e: 'Ibisbill', 0x19: 'Greyhound',
  0x2a: 'Hoopoe', 0x2b: 'Jabiru', 0x2c: 'Kaka', 0x2d: 'Loon',
};

export interface FirmwareCheck {
  model: string;
  hwVersion: string;
  serial: string;
  currentFw: string;
  battery: number;
  latestVersion: string;
  uploadDate: string;
  releaseType: string;
  downloadUrl: string;
}

/** Reads the connected watch (model/hw/fw/serial/battery) and asks Suunto's service for the
 * latest firmware for it. Read-only — sends nothing to the watch. Opens/closes the cable. */
export async function checkFirmware(): Promise<FirmwareCheck> {
  const conn: any = await connect();
  let info: any;
  try {
    info = await getDeviceInfo();
  } finally {
    await disconnect().catch(() => {});
  }
  // In BSL the device_info model reads "BSL"; resolve the real codename from the USB product id
  // so a watch stuck in the bootloader still fetches the right firmware and can be recovered.
  const inBsl = info.model === 'BSL';
  const model = inBsl ? (PID_CODENAME[conn?.productId] || '') : (info.model || '');
  const hwVersion = info.hwVersion || '';
  if (!model || !hwVersion) throw new Error(inBsl
    ? `watch is in bootloader (BSL) and its model could not be resolved from product 0x${(conn?.productId ?? 0).toString(16)}`
    : 'could not read the watch model/hardware');

  const url = `${BASE_URL}/${encodeURIComponent(model)}/${encodeURIComponent(hwVersion)}?appkey=${APP_KEY}`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`firmware check failed: HTTP ${resp.status}`);
  const j: any = await resp.json();

  return {
    model,
    hwVersion,
    serial: info.serial || '',
    currentFw: info.fwVersion || '',
    battery: typeof info.battery === 'number' ? info.battery : -1,
    latestVersion: j.LatestFirmwareVersion || '',
    uploadDate: j.FirmwareUploadDate || '',
    releaseType: j.ReleaseType || '',
    downloadUrl: j.LatestFirmwareURI || '',
  };
}

/** Downloads the .sfi at `url` to a local cache file and returns its path. Validates the
 * SFI2ST magic before returning so a bad download never reaches the flasher. */
export async function downloadFirmware(url: string): Promise<string> {
  if (!url) throw new Error('no firmware download URL');
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`firmware download failed: HTTP ${resp.status}`);
  const buf = new Uint8Array(await resp.arrayBuffer());
  if (buf.length <= 32 || String.fromCharCode(buf[0], buf[1], buf[2], buf[3], buf[4], buf[5]) !== 'SFI2ST') {
    throw new Error('downloaded file is not an SFI2ST firmware container');
  }
  const name = url.split('/').pop() || `firmware_${Date.now()}.sfi`;
  const path = `${RNFS.CachesDirectoryPath}/${name}`;
  await RNFS.writeFile(path, bytesToBase64(buf), 'base64');
  return path;
}
