import { connect, disconnect, getDeviceInfo, readSettingsRaw, readPersonalSettings } from '../native/AmbitUsbModule';
import {
  AMBIT3_SETTINGS_FIELDS, KAILASH_SETTINGS_FIELDS, SettingField,
  decodeSettings, DecodedSetting,
} from './AmbitSettingsReader';
import { decodePersonalSettings } from './AmbitPersonalSettingsReader';
import { writeSetting as writeSettingRaw, WriteSettingResult } from './AmbitSettingsWriter';

// The Ambit 1 / Ambit 2 family (Ambit, Ambit2, Ambit2 S, Ambit2 R) uses the older legacy
// personal-settings mechanism, not the Ambit3/Kailash SBEM 0x1100 - a different read path
// (readPersonalSettings) and read-only (no write in libambit). Detected by the watch's own
// name from getDeviceInfo()'s device list. USB-only family (no Bluetooth).
function isAmbit12(name?: string): boolean {
  if (!name) return false;
  return name === 'Suunto Ambit' || name.startsWith('Suunto Ambit 2');
}

// Traverse and Traverse Alpha. openambit drives them with the SAME ambit3 driver as the
// Ambit3 family (device_support.c), so they READ fine with the Ambit3 SBEM path/table. But
// they're shown READ-ONLY for now: we haven't verified a write against real Traverse hardware,
// and they have real features the Ambit3 doesn't (Traverse Alpha's shot-detection/hunting-
// fishing modes, Traverse backlight/POD differences) that the shared Ambit3 table doesn't
// cover. TODO: give them their own field tables from a real descriptor (like Kailash got),
// then re-enable writing once verified.
function isTraverse(name?: string): boolean {
  if (!name) return false;
  return name.startsWith('Suunto Traverse');
}

// Thin connect/read/disconnect and connect/write/disconnect orchestration, matching
// PoiService.ts's own exportPoisToGpx()/addPoiToWatch() pattern exactly - this screen owns
// its own short-lived connection per action rather than assuming one is already open
// (HomeScreen's own auto-connect-on-USB-attach flow is separate and unrelated).
//
// Real, 2026-08-08: Kailash settings are confirmed writable over cable too (same day as
// the Ambit3 result - custom_modes_andre.md's "Kailash settings ARE writable over cable
// too" section), using its own separately-curated field table. Which table applies is
// only known after connecting (getDeviceInfo().model === 'Hoopoe' is Kailash - the same
// check HomeScreen.tsx's own isKailash() already uses), so readAmbitSettings() detects it
// once per read and hands the matching table back in state for the caller to reuse on any
// subsequent write - no separate device-detection round trip needed there.

export interface ReadSettingsState {
  phase: 'idle' | 'connecting' | 'reading' | 'done' | 'error';
  settings?: DecodedSetting[];
  fields?: SettingField[];
  isKailash?: boolean;
  // The connected watch's own friendly name (e.g. "Suunto Kailash", "Suunto Ambit3
  // Peak") from getDeviceInfo()'s device list, so the UI can label the section with the
  // real device instead of a hardcoded "Ambit3".
  deviceName?: string;
  // True for the Ambit 1/2 family: settings are shown but not editable (no personal-
  // settings write exists in libambit). The UI renders values statically and hides the
  // write controls.
  readOnly?: boolean;
  error?: string;
}

/** Real, read-only (0x1100, four zero bytes) - safe any time the watch is connected. */
export async function readAmbitSettings(onState: (s: ReadSettingsState) => void): Promise<void> {
  onState({ phase: 'connecting' });
  try {
    await connect();
  } catch (e: any) {
    onState({ phase: 'error', error: e?.message ?? 'Connection to the watch failed' });
    return;
  }
  onState({ phase: 'reading' });
  try {
    let isKailash = false;
    let deviceName: string | undefined;
    try {
      const info = await getDeviceInfo();
      isKailash = info.model === 'Hoopoe';
      deviceName = info.name || undefined;
    } catch { /* non-fatal - assume Ambit3 */ }

    // Ambit 1/2 family: legacy personal-settings read, read-only (no `fields` -> no write).
    if (isAmbit12(deviceName)) {
      const settings = decodePersonalSettings(await readPersonalSettings());
      onState({ phase: 'done', settings, deviceName, readOnly: true });
      return;
    }

    const fields = isKailash ? KAILASH_SETTINGS_FIELDS : AMBIT3_SETTINGS_FIELDS;
    const settings = decodeSettings(await readSettingsRaw(), fields);
    // Traverse / Traverse Alpha: read with the Ambit3 table but show read-only (no write
    // table handed back), until verified on real hardware. Ambit3 / Kailash stay writable.
    if (isTraverse(deviceName)) {
      onState({ phase: 'done', settings, deviceName, readOnly: true });
    } else {
      onState({ phase: 'done', settings, fields, isKailash, deviceName });
    }
  } catch (e: any) {
    onState({ phase: 'error', error: e?.message ?? 'Failed to read settings' });
  } finally {
    await disconnect().catch(() => {});
  }
}

export interface WriteSettingState {
  phase: 'idle' | 'connecting' | 'writing' | 'done' | 'error';
  result?: WriteSettingResult;
  error?: string;
}

/** Real, hardware-confirmed write (2026-08-08, both device types - see
 * AmbitSettingsWriter.ts's own writeSetting() for the read-patch-write-confirm dance
 * itself). `fields` must be the same table readAmbitSettings() returned in its own state -
 * the caller (SettingsScreen.tsx) already has it from the read that produced the row being
 * edited, so no extra device-detection round trip happens here. */
export async function writeAmbitSetting(
  key: string,
  value: number,
  fields: SettingField[],
  onState: (s: WriteSettingState) => void,
): Promise<void> {
  onState({ phase: 'connecting' });
  try {
    await connect();
  } catch (e: any) {
    onState({ phase: 'error', error: e?.message ?? 'Connection to the watch failed' });
    return;
  }
  onState({ phase: 'writing' });
  try {
    const result = await writeSettingRaw(key, value, fields);
    onState({
      phase: result.ok ? 'done' : 'error',
      result,
      error: result.ok ? undefined : (result.error ?? 'Write sent but not confirmed by re-read'),
    });
  } catch (e: any) {
    onState({ phase: 'error', error: e?.message ?? 'Failed to write the setting' });
  } finally {
    await disconnect().catch(() => {});
  }
}
