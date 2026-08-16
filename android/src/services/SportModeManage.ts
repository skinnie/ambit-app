import { connect, disconnect, readCustomModesRaw, writeCustomModesRaw } from '../native/AmbitUsbModule';
import { base64ToBytes, bytesToBase64 } from './Base64';
import {
  decode, encodeBody, encodeRegion, summarise,
  createSportMode, deleteSportMode, createMultisport, editMultisport, deleteMultisport,
  DecodedRegion, LimitError,
} from './SportModeCodec';

// Orchestration for structural sport-mode edits (create / delete / multisport), mirroring
// CustomModesService.ts's own connect/read/disconnect and connect/write/disconnect pattern.
// The heavy lifting (decode, mutate, re-encode byte-exact) is SportModeCodec, proven against
// SuuntoLink's own capture in SportModeCodec.test.ts (16/16). Ambit3-only, same gate as the
// rest of the sport-mode UI (Kailash has no CustomModes region; Traverse's own limits differ
// but this feature is only surfaced for the Ambit3 family - see SportModesScreen.tsx).
//
// THE SAFETY RULE, exactly as sport_mode_manage.py and CustomModesWriter enforce it: the
// region read off the watch is decoded and re-encoded FIRST, and if that does not come back
// byte-identical the write is refused. If we cannot reproduce what is already on the watch,
// we have no business writing a modified version of it.

// The gap SuuntoLink leaves between the writes of a multi-write creation (measured at 2 s in
// the capture). It is elapsed work, not a fixed wait, so this is a floor.
const STAMP_GAP_MS = 2000;
const delay = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

export interface SportModeManageState {
  phase: 'idle' | 'connecting' | 'reading' | 'writing' | 'verifying' | 'done' | 'error';
  step?: number;      // which region write is in flight (1-based), for a multi-write create
  totalSteps?: number;
  error?: string;
}

export type SportSummary = ReturnType<typeof summarise>;

/** Read + decode + summarise the current sport modes. Read-only, safe any time connected. */
export async function readSportModes(): Promise<SportSummary> {
  await connect();
  try {
    const bytes = base64ToBytes(await readCustomModesRaw());
    return summarise(decode(bytes));
  } finally {
    await disconnect().catch(() => {});
  }
}

function reEncodesExact(original: Uint8Array): boolean {
  const body = encodeBody(decode(original));
  if (body.length > original.length) return false;
  for (let i = 0; i < body.length; i++) if (body[i] !== original[i]) return false;
  for (let i = body.length; i < original.length; i++) if (original[i] !== 0xff) return false;
  return true;
}

// The plan builders each take the freshly-decoded live region and return the ordered list of
// region STATES to write (a create is three; everything else is one), throwing LimitError if
// a watch/SuuntoLink rule would be broken. `variant` defaults to Emu (Ambit3 Peak) inside the
// codec - correct for the whole Ambit3 family this feature is gated to (all share 10/2 limits).
export type PlanBuilder = (live: DecodedRegion) => DecodedRegion[];

export const plans = {
  create: (name: string, activityId: number): PlanBuilder =>
    live => createSportMode(live, name, activityId),
  delete: (name: string): PlanBuilder =>
    live => deleteSportMode(live, name),
  createMultisport: (name: string, activityId: number, legs: string[]): PlanBuilder =>
    live => createMultisport(live, name, activityId, legs),
  editMultisport: (name: string, opts: { newName?: string; activityId?: number; legs?: string[] }): PlanBuilder =>
    live => editMultisport(live, name, opts),
  deleteMultisport: (name: string): PlanBuilder =>
    live => deleteMultisport(live, name),
};

/** Apply one structural edit. Reads the region, enforces the safety rule, builds the plan,
 * writes each region state (with the inter-write gap for a multi-write create), then re-reads
 * and confirms the watch matches the final state. Returns the fresh summary on success.
 *
 * NOT yet hardware-confirmed on Android (see writeCustomModesRaw()'s own doc comment) - the
 * PAYLOAD is proven byte-identical to SuuntoLink's (SportModeCodec.test.ts), but this
 * read-modify-write composition hasn't run against a real watch on this platform yet. */
export async function applySportModeEdit(
  build: PlanBuilder,
  onState: (s: SportModeManageState) => void,
): Promise<SportSummary | undefined> {
  onState({ phase: 'connecting' });
  try {
    await connect();
  } catch (e: any) {
    onState({ phase: 'error', error: e?.message ?? 'Connection to the watch failed' });
    return undefined;
  }
  try {
    onState({ phase: 'reading' });
    const original = base64ToBytes(await readCustomModesRaw());
    const regionSize = original.length;

    // THE SAFETY RULE: refuse to modify what we cannot reproduce byte-exact.
    if (!reEncodesExact(original)) {
      onState({ phase: 'error', error: "This watch's sport-mode region doesn't re-encode byte-exact, so no modified version may be written. (Nothing was sent.)" });
      return undefined;
    }

    let plan: DecodedRegion[];
    try {
      plan = build(decode(original));
    } catch (e: any) {
      // A rule the watch enforces (limits, name clash, ...) - refused before any write.
      const msg = e instanceof LimitError ? e.message : (e?.message ?? 'Refused');
      onState({ phase: 'error', error: msg });
      return undefined;
    }

    for (let i = 0; i < plan.length; i++) {
      if (i > 0) await delay(STAMP_GAP_MS);
      onState({ phase: 'writing', step: i + 1, totalSteps: plan.length });
      const region = encodeRegion(plan[i], regionSize);
      const ok = await writeCustomModesRaw(bytesToBase64(region));
      if (!ok) {
        onState({ phase: 'error', step: i + 1, totalSteps: plan.length, error: `Write ${i + 1}/${plan.length} was not acknowledged by the watch.` });
        return undefined;
      }
    }

    // Prove it, don't just trust the ACKs: re-read and require the region to match the final
    // plan state byte-for-byte (same standard the field/rename writers already hold).
    onState({ phase: 'verifying' });
    const readback = base64ToBytes(await readCustomModesRaw());
    const wanted = encodeRegion(plan[plan.length - 1], regionSize);
    let matches = readback.length === wanted.length;
    for (let i = 0; matches && i < wanted.length; i++) if (readback[i] !== wanted[i]) matches = false;
    if (!matches) {
      onState({ phase: 'error', error: 'The writes completed but the watch read back different bytes than expected.' });
      return undefined;
    }

    onState({ phase: 'done' });
    return summarise(decode(readback));
  } catch (e: any) {
    onState({ phase: 'error', error: e?.message ?? 'Failed to apply the change' });
    return undefined;
  } finally {
    await disconnect().catch(() => {});
  }
}
