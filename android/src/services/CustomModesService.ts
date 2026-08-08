import { connect, disconnect, readCustomModesRaw } from '../native/AmbitUsbModule';
import { base64ToBytes } from './Base64';
import { decode, ExerciseMode } from './CustomModesReader';
import {
  renameMode as renameModeRaw, RenameModeResult,
  writeField as writeFieldRaw, WriteFieldResult,
  writeDisplayField as writeDisplayFieldRaw, WriteDisplayFieldResult,
} from './CustomModesWriter';

// Thin connect/read/disconnect and connect/write/disconnect orchestration, matching
// AmbitSettingsService.ts's own pattern exactly - this screen owns its own short-lived
// connection per action rather than assuming one is already open. Ambit3-only: Kailash's
// own memory map reports no CustomModes region at all (confirmed empty, see
// custom_modes_andre.md's Kailash section) - the caller (SportModesScreen.tsx) is
// responsible for not showing this feature for a Kailash connection, the same
// !HomeViewModel.isKailash gate the desktop app's own NavRail.qml uses.

export interface ReadCustomModesState {
  phase: 'idle' | 'connecting' | 'reading' | 'done' | 'error';
  modes?: ExerciseMode[];
  error?: string;
}

/** Real, read-only (0x0b17 flash read) - safe any time the watch is connected. */
export async function readCustomModes(onState: (s: ReadCustomModesState) => void): Promise<void> {
  onState({ phase: 'connecting' });
  try {
    await connect();
  } catch (e: any) {
    onState({ phase: 'error', error: e?.message ?? 'Connection to the watch failed' });
    return;
  }
  onState({ phase: 'reading' });
  try {
    const bytes = base64ToBytes(await readCustomModesRaw());
    const decoded = decode(bytes);
    onState({ phase: 'done', modes: decoded.exerciseModes });
  } catch (e: any) {
    onState({ phase: 'error', error: e?.message ?? 'Failed to read CustomModes' });
  } finally {
    await disconnect().catch(() => {});
  }
}

export interface CustomModesWriteState {
  phase: 'idle' | 'connecting' | 'writing' | 'done' | 'error';
  error?: string;
}

/** Real mechanism, NOT yet hardware-confirmed on Android (see writeCustomModesRaw()'s own
 * doc comment in native/AmbitUsbModule.ts). Renames one mode everywhere it appears in the
 * real parsed tree; re-reads afterward to confirm. */
export async function renameCustomMode(
  fromName: string, toName: string, onState: (s: CustomModesWriteState) => void,
): Promise<RenameModeResult | undefined> {
  onState({ phase: 'connecting' });
  try {
    await connect();
  } catch (e: any) {
    onState({ phase: 'error', error: e?.message ?? 'Connection to the watch failed' });
    return undefined;
  }
  onState({ phase: 'writing' });
  try {
    const result = await renameModeRaw(fromName, toName);
    onState({ phase: result.ok ? 'done' : 'error',
      error: result.ok ? undefined : (result.error ?? 'Write sent but not confirmed by re-read') });
    return result;
  } catch (e: any) {
    onState({ phase: 'error', error: e?.message ?? 'Failed to rename' });
    return undefined;
  } finally {
    await disconnect().catch(() => {});
  }
}

/** Real mechanism, NOT yet hardware-confirmed on Android. Writes one or more of a mode's
 * fixed uint16 settings fields (Autolap, HrHigh, HrLow, HrLimitsUse, UseHw, ...). */
export async function writeCustomModeField(
  modeName: string, fields: Record<string, number>, onState: (s: CustomModesWriteState) => void,
): Promise<WriteFieldResult | undefined> {
  onState({ phase: 'connecting' });
  try {
    await connect();
  } catch (e: any) {
    onState({ phase: 'error', error: e?.message ?? 'Connection to the watch failed' });
    return undefined;
  }
  onState({ phase: 'writing' });
  try {
    const result = await writeFieldRaw(modeName, fields);
    onState({ phase: result.ok ? 'done' : 'error',
      error: result.ok ? undefined : (result.error ?? 'Write sent but not confirmed by re-read') });
    return result;
  } catch (e: any) {
    onState({ phase: 'error', error: e?.message ?? 'Failed to write field(s)' });
    return undefined;
  } finally {
    await disconnect().catch(() => {});
  }
}

/** Real mechanism, NOT yet hardware-confirmed on Android. Changes which data a display row
 * shows - give newIndexName and/or newTypeName; the omitted one is left unchanged. Real,
 * live-confirmed 2026-08-08 (on desktop): for the common Index=FT_TIME case, Type (not
 * Index) is what actually selects the rendered content - see CustomModesWriter.ts's own
 * writeDisplayField() doc comment. */
export async function writeCustomModeDisplayField(
  modeName: string, displayIndex: number, fieldIndex: number,
  newIndexName: string | undefined, newTypeName: string | undefined,
  onState: (s: CustomModesWriteState) => void,
): Promise<WriteDisplayFieldResult | undefined> {
  onState({ phase: 'connecting' });
  try {
    await connect();
  } catch (e: any) {
    onState({ phase: 'error', error: e?.message ?? 'Connection to the watch failed' });
    return undefined;
  }
  onState({ phase: 'writing' });
  try {
    const result = await writeDisplayFieldRaw(modeName, displayIndex, fieldIndex, newIndexName, newTypeName);
    onState({ phase: result.ok ? 'done' : 'error',
      error: result.ok ? undefined : (result.error ?? 'Write sent but not confirmed by re-read') });
    return result;
  } catch (e: any) {
    onState({ phase: 'error', error: e?.message ?? 'Failed to write display field' });
    return undefined;
  } finally {
    await disconnect().catch(() => {});
  }
}
