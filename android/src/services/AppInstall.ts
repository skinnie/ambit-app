import { connect, disconnect, readRegion, readCustomModesRaw, writeRegion, writeCustomModesRaw } from '../native/AmbitUsbModule';
import { base64ToBytes, bytesToBase64 } from './Base64';
import { decode as decodeCM, encodeRegion, DecodedRegion } from './SportModeCodec';
import { decodeApps, buildAppsRegion, APPS_BASE, APPS_REGION_SIZE } from './AppsCodec';
import { CatalogEntry, getBinary } from './CatalogService';
import { installShortcutIntoMode } from './AppInstallCore';

// Re-export the pure core so callers have one import surface.
export { installShortcutIntoMode, APP_SLOT_TYPES } from './AppInstallCore';

const CUSTOM_MODES_SIZE = 12288;

const u16 = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8);
const u32 = (b: Uint8Array, o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

// ─── orchestration ────────────────────────────────────────────────────────────────────────
export interface InstallState {
  phase: 'idle' | 'compiling' | 'connecting' | 'reading' | 'writingApps' | 'writingModes' | 'verifying' | 'done' | 'error';
  error?: string;
}

/** Read the Apps region's used length from its directory header (total_length = the last u32 of
 * the [u16 n][u16 n^2][u32 offset]*n [u32 total] table). Returns 0 for an empty/0xFF region. */
function appsUsedLength(probe: Uint8Array): number {
  if (probe.length < 8) return 0;
  const n = u16(probe, 0);
  const tableLen = 4 + 4 * (n + 1);
  if (n === 0 || n > 1000 || tableLen > probe.length) return 0;
  return u32(probe, 4 + 4 * n);
}

function bytesEqualPrefix(a: Uint8Array, b: Uint8Array, len: number): boolean {
  for (let i = 0; i < len; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * Install a Suunto App from the imported catalog onto (modeIndex, displayIndex, fieldIndex).
 * Reads both regions, builds the new Apps region (whole-region rewrite) + the CustomModes
 * shortcut, writes Apps via writeRegion and CustomModes via writeCustomModesRaw (both no
 * commit), then re-reads and verifies. NOT yet hardware-confirmed on Android - the PAYLOAD is
 * proven byte-exact (AppsCodec + SportModeCodec tests), this read-modify-write composition is
 * not yet run against a real watch on this platform.
 */
export async function installApp(
  entry: CatalogEntry, modeIndex: number, displayIndex: number, fieldIndex: number,
  onState: (s: InstallState) => void,
): Promise<boolean> {
  onState({ phase: 'reading' });
  let binary: Uint8Array;
  try { binary = await getBinary(entry); }
  catch (e: any) { onState({ phase: 'error', error: e?.message ?? 'Could not read the app bytecode' }); return false; }
  return installCompiledApp(binary, entry.activityId, entry.name, modeIndex, displayIndex, fieldIndex, onState);
}

/** Install an app from its raw compiled bytecode (used by both the catalog install above and
 * the Intervals workout compiler). Same read-modify-write-verify as installApp. */
export async function installCompiledApp(
  binary: Uint8Array, activityId: number, name: string,
  modeIndex: number, displayIndex: number, fieldIndex: number,
  onState: (s: InstallState) => void,
): Promise<boolean> {
  onState({ phase: 'connecting' });
  try { await connect(); } catch (e: any) {
    onState({ phase: 'error', error: e?.message ?? 'Connection to the watch failed' }); return false;
  }
  try {
    onState({ phase: 'reading' });

    // Apps region: probe the directory, then read exactly the used extent so existing entries'
    // raw blocks are complete (a truncated read would corrupt them on rebuild).
    const probe = base64ToBytes(await readRegion(APPS_BASE, 8192));
    const usedLen = appsUsedLength(probe);
    const appsRegion = usedLen > 0 ? base64ToBytes(await readRegion(APPS_BASE, usedLen)) : new Uint8Array(0);
    const existing = decodeApps(appsRegion);
    const ruleIdx = existing.length; // the new app's 0-based index in the Apps region

    const newApps = buildAppsRegion(existing.map(e => e.rawBlock), { binary, activityId, name });
    if (newApps.length > APPS_REGION_SIZE) {
      onState({ phase: 'error', error: 'The Apps region would overflow - remove an app first.' }); return false;
    }

    // CustomModes shortcut.
    const cm = decodeCM(base64ToBytes(await readCustomModesRaw()));
    const now = Math.floor(Date.now() / 1000);
    let cmNew: DecodedRegion;
    try {
      cmNew = installShortcutIntoMode(cm, modeIndex, displayIndex, fieldIndex, ruleIdx, now);
    } catch (e: any) {
      onState({ phase: 'error', error: e?.message ?? 'Could not wire the app into that screen' }); return false;
    }
    const cmImage = encodeRegion(cmNew, CUSTOM_MODES_SIZE);

    // Write Apps first, then CustomModes - the order a real SuuntoLink install uses.
    onState({ phase: 'writingApps' });
    if (!await writeRegion(APPS_BASE, bytesToBase64(newApps), newApps.length)) {
      onState({ phase: 'error', error: 'Apps region write was not acknowledged.' }); return false;
    }
    onState({ phase: 'writingModes' });
    if (!await writeCustomModesRaw(bytesToBase64(cmImage))) {
      onState({ phase: 'error', error: 'Sport-mode write was not acknowledged.' }); return false;
    }

    // Prove it: re-read and require both regions to match what we sent.
    onState({ phase: 'verifying' });
    const appsBack = base64ToBytes(await readRegion(APPS_BASE, newApps.length));
    if (!bytesEqualPrefix(appsBack, newApps, newApps.length)) {
      onState({ phase: 'error', error: 'Apps region read back different bytes than written.' }); return false;
    }
    const cmBack = base64ToBytes(await readCustomModesRaw());
    if (!bytesEqualPrefix(cmBack, cmImage, cmImage.length)) {
      onState({ phase: 'error', error: 'Sport-mode region read back different bytes than written.' }); return false;
    }

    onState({ phase: 'done' });
    return true;
  } catch (e: any) {
    onState({ phase: 'error', error: e?.message ?? 'Install failed' });
    return false;
  } finally {
    await disconnect().catch(() => {});
  }
}
