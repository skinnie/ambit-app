import { connect, disconnect, getDeviceInfo, readSettingsRaw } from '../native/AmbitUsbModule';
import {
  AMBIT3_SETTINGS_FIELDS, KAILASH_SETTINGS_FIELDS, SettingField,
  decodeSettings, DecodedSetting,
} from './AmbitSettingsReader';
import { writeSetting as writeSettingRaw, WriteSettingResult } from './AmbitSettingsWriter';

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
    try { isKailash = (await getDeviceInfo()).model === 'Hoopoe'; } catch { /* non-fatal - assume Ambit3 */ }
    const fields = isKailash ? KAILASH_SETTINGS_FIELDS : AMBIT3_SETTINGS_FIELDS;
    const settings = decodeSettings(await readSettingsRaw(), fields);
    onState({ phase: 'done', settings, fields, isKailash });
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
