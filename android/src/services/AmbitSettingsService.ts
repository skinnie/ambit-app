import { connect, disconnect, getDeviceInfo, readSettingsRaw, readPersonalSettings, isBleTransportActive } from '../native/AmbitUsbModule';
import {
  AMBIT3_SETTINGS_FIELDS, TRAVERSE_SETTINGS_FIELDS, KAILASH_SETTINGS_FIELDS, SettingField,
  decodeSettings, DecodedSetting,
} from './AmbitSettingsReader';
import { decodePersonalSettings } from './AmbitPersonalSettingsReader';
import { writeSetting as writeSettingRaw, WriteSettingResult, WriteDevice } from './AmbitSettingsWriter';
import { readGlonassStatus, GlonassStatus } from './SgeeService';

// The Ambit 1 / Ambit 2 family (Ambit, Ambit2, Ambit2 S, Ambit2 R) uses the older legacy
// personal-settings mechanism, not the Ambit3/Kailash SBEM 0x1100 - a different read path
// (readPersonalSettings) and read-only (no write in libambit). Detected by the watch's own
// name from getDeviceInfo()'s device list. USB-only family (no Bluetooth).
function isAmbit12(name?: string): boolean {
  if (!name) return false;
  return name === 'Suunto Ambit' || name.startsWith('Suunto Ambit 2');
}

// Traverse and Traverse Alpha. openambit drives them with the SAME ambit3 driver as the Ambit3
// family, but their SCHEMA assigns different entry ids (Personal.Weight is 0x1b, not the
// Ambit3's 0x19; nearly every id is shifted). 2026-08-16: they now have their OWN generated
// field table (TRAVERSE_SETTINGS_FIELDS) + write templates from the real Traverse fw 2.0.22
// descriptor, so they read correctly and are writable via the same 0x1101 mechanism (the
// per-screen templates resolved through the Traverse schema).
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
  // Which write plumbing the caller should pass back on a write - 'ambit3' | 'traverse' |
  // 'kailash'. Undefined means read-only (Ambit 1/2). See AmbitSettingsWriter.WriteDevice.
  writeDevice?: WriteDevice;
  isKailash?: boolean;
  // The connected watch's own friendly name (e.g. "Suunto Kailash", "Suunto Ambit3
  // Peak") from getDeviceInfo()'s device list, so the UI can label the section with the
  // real device instead of a hardcoded "Ambit3".
  deviceName?: string;
  // True for the Ambit 1/2 family: settings are shown but not editable (no personal-
  // settings write exists in libambit). The UI renders values statically and hides the
  // write controls.
  readOnly?: boolean;
  // Whether the connected watch declares a GlonassSGEE region (Traverse/Kailash yes, the
  // Ambit3 Peak/Sport no), read from its 0x0b21 map in this same connection so the settings
  // screen can show the "Orbital data / Ephemeris GPS only" group without a second round trip.
  // Desktop parity: DeviceService.glonassSupported.
  glonass?: GlonassStatus;
  error?: string;
}

/** Real, read-only (0x1100, four zero bytes) - safe any time the watch is connected. */
export async function readAmbitSettings(onState: (s: ReadSettingsState) => void): Promise<void> {
  // Over BLE the link is already open (HomeScreen owns it); the USB connect() would pop the
  // OTG prompt and tear down the BLE session. read/writeSettingsRaw act on the shared native
  // device either way. Same transport fix as CustomModesService. André, 2026-08-17.
  const overBle = isBleTransportActive();
  onState({ phase: overBle ? 'reading' : 'connecting' });
  if (!overBle) {
    try {
      await connect();
    } catch (e: any) {
      onState({ phase: 'error', error: e?.message ?? 'Connection to the watch failed' });
      return;
    }
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

    // Per-device field table AND write plumbing, keyed off the connected watch: each schema
    // family assigns its own entry ids, so one table can't serve all three.
    const traverse = isTraverse(deviceName);
    const fields = isKailash ? KAILASH_SETTINGS_FIELDS
      : traverse ? TRAVERSE_SETTINGS_FIELDS
      : AMBIT3_SETTINGS_FIELDS;
    const writeDevice: WriteDevice = isKailash ? 'kailash' : traverse ? 'traverse' : 'ambit3';
    const settings = decodeSettings(await readSettingsRaw(), fields);
    // Same connection: does this watch carry a GLONASS ephemeris region? Non-fatal - a map
    // read that fails just means the "Orbital data" group stays hidden, never a failed read.
    let glonass: GlonassStatus | undefined;
    try { glonass = await readGlonassStatus(); } catch { /* leave undefined */ }
    onState({ phase: 'done', settings, fields, writeDevice, isKailash, deviceName, glonass });
  } catch (e: any) {
    onState({ phase: 'error', error: e?.message ?? 'Failed to read settings' });
  } finally {
    if (!overBle) await disconnect().catch(() => {});
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
  device: WriteDevice,
  onState: (s: WriteSettingState) => void,
): Promise<void> {
  // Over BLE the link is already open (HomeScreen owns it); the USB connect() would pop the
  // OTG prompt and tear down the BLE session. read/writeSettingsRaw act on the shared native
  // device either way. Same transport fix as CustomModesService. André, 2026-08-17.
  const overBle = isBleTransportActive();
  onState({ phase: overBle ? 'writing' : 'connecting' });
  if (!overBle) {
    try {
      await connect();
    } catch (e: any) {
      onState({ phase: 'error', error: e?.message ?? 'Connection to the watch failed' });
      return;
    }
  }
  onState({ phase: 'writing' });
  try {
    const result = await writeSettingRaw(key, value, fields, device);
    onState({
      phase: result.ok ? 'done' : 'error',
      result,
      error: result.ok ? undefined : (result.error ?? 'Write sent but not confirmed by re-read'),
    });
  } catch (e: any) {
    onState({ phase: 'error', error: e?.message ?? 'Failed to write the setting' });
  } finally {
    if (!overBle) await disconnect().catch(() => {});
  }
}
