import { connect, disconnect, readSettingsRaw } from '../native/AmbitUsbModule';
import { decodeSettings, DecodedSetting } from './AmbitSettingsReader';
import { writeSetting as writeSettingRaw, WriteSettingResult } from './AmbitSettingsWriter';

// Thin connect/read/disconnect and connect/write/disconnect orchestration, matching
// PoiService.ts's own exportPoisToGpx()/addPoiToWatch() pattern exactly - this screen owns
// its own short-lived connection per action rather than assuming one is already open
// (HomeScreen's own auto-connect-on-USB-attach flow is separate and unrelated).

export interface ReadSettingsState {
  phase: 'idle' | 'connecting' | 'reading' | 'done' | 'error';
  settings?: DecodedSetting[];
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
    const settings = decodeSettings(await readSettingsRaw());
    onState({ phase: 'done', settings });
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

/** Real, hardware-confirmed write (2026-08-08) - see AmbitSettingsWriter.ts's own
 * writeSetting() for the read-patch-write-confirm dance itself; this just wraps it in the
 * same connect/.../disconnect shape every other real write in this app already uses. */
export async function writeAmbitSetting(
  key: string,
  value: number,
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
    const result = await writeSettingRaw(key, value);
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
