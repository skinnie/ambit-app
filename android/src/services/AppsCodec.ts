// Ambit3 "Apps" flash region codec - direct port of tools/apps.py (decode) and
// tools/workout_install.py's build_apps_region (encode). The region is a self-describing
// directory (Finding 25/29), rewritten WHOLE on every install:
//
//   [u16 num_entries][u16 num_entries ^ 0x02][u32 entry_offset]*n [u32 total_length]
//   then, back to back, one block per entry at its own offset:
//     [u8 0][u8 activityId][u8 marker][name iso-8859-15, null-padded to 29B]
//     [8-byte "IAMRULE\0" magic][compiled bytecode]
//
// The marker is a 1-byte XOR checksum (== openambit's calculate_app_rule_checksum), proven
// byte-exact against all 26 real entries this project has. This module only builds/reads the
// Apps region; wiring the app to a sport-mode display (the 51/52/53 shortcut) is a CustomModes
// edit done with the already-proven SportModeCodec - see AppInstall.ts.

export const APPS_BASE = 0x0927c0;
export const APPS_REGION_SIZE = 200000;
const MAGIC = Uint8Array.from([0x49, 0x41, 0x4d, 0x52, 0x55, 0x4c, 0x45, 0x00]); // "IAMRULE\0"
export const NAME_LEN = 29;
const ENTRY_HEADER_LEN = 3;
const ENTRY_BLOCK_LEN = ENTRY_HEADER_LEN + NAME_LEN; // 32: entry_offset -> magic

const u16 = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8);
const u32 = (b: Uint8Array, o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

// ISO-8859-15 encode (same 8 special code points as SportModeCodec / CustomModesWriter).
const UNI_TO_ISO: Record<number, number> = {
  0x20ac: 0xa4, 0x0160: 0xa6, 0x0161: 0xa8, 0x017d: 0xb4, 0x017e: 0xb8, 0x0152: 0xbc, 0x0153: 0xbd, 0x0178: 0xbe,
};
const ISO_TO_UNI: Record<number, number> = {
  0xa4: 0x20ac, 0xa6: 0x0160, 0xa8: 0x0161, 0xb4: 0x017d, 0xb8: 0x017e, 0xbc: 0x0152, 0xbd: 0x0153, 0xbe: 0x0178,
};
function encodeIso(s: string, max: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < s.length && out.length < max; i++) {
    const c = s.charCodeAt(i);
    const m = UNI_TO_ISO[c];
    out.push(m !== undefined ? m : (c <= 0xff ? c : 0x3f));
  }
  return out;
}
function decodeIso(b: Uint8Array): string {
  let s = '';
  for (const x of b) s += String.fromCharCode(ISO_TO_UNI[x] ?? x);
  return s;
}

/** The per-entry 'marker' byte: XOR of (MAGIC + bytecode), then XOR the low byte of that
 * payload's length. Exact port of apps.entry_checksum / openambit calculate_app_rule_checksum. */
export function entryChecksum(binary: Uint8Array): number {
  let c = 0;
  for (const x of MAGIC) c ^= x;
  for (const x of binary) c ^= x;
  const len = (MAGIC.length + binary.length) & 0xff;
  return c ^ len;
}

export interface AppEntry {
  entryOffset: number;
  activityId: number;
  marker: number;
  name: string;
  binary: Uint8Array;   // bytecode WITHOUT the leading magic
  rawBlock: Uint8Array; // [header][name][magic][binary] verbatim - for lossless rebuild
}

function startsWithMagic(b: Uint8Array, off: number): boolean {
  // apps.decode checks MAGIC[:-1] (the 7 visible chars) to tolerate a name that ran long.
  for (let i = 0; i < MAGIC.length - 1; i++) if (b[off + i] !== MAGIC[i]) return false;
  return true;
}

/** Decode the Apps region into its live entries (with each entry's raw block). Returns [] for
 * an empty/all-0xFF region or anything that doesn't match the directory format - never guesses. */
export function decodeApps(data: Uint8Array): AppEntry[] {
  if (data.length < 4) return [];
  const numEntries = u16(data, 0);
  const tableLen = 4 + 4 * (numEntries + 1);
  if (numEntries === 0 || numEntries > 1000 || tableLen > data.length) return [];
  const table: number[] = [];
  for (let i = 0; i < numEntries + 1; i++) table.push(u32(data, 4 + i * 4));
  if (table[0] !== tableLen) return []; // first offset must equal directory size (real invariant)
  const totalLength = table[numEntries];
  const entries: AppEntry[] = [];
  for (let i = 0; i < numEntries; i++) {
    const off = table[i];
    const magicOff = off + ENTRY_BLOCK_LEN;
    if (!startsWithMagic(data, magicOff)) return []; // format mismatch - bail rather than guess
    const activityId = data[off + 1];
    const marker = data[off + 2];
    const nameField = data.subarray(off + ENTRY_HEADER_LEN, off + ENTRY_BLOCK_LEN);
    let nameEnd = 0; while (nameEnd < nameField.length && nameField[nameEnd] !== 0) nameEnd++;
    const name = decodeIso(nameField.subarray(0, nameEnd));
    const binStart = magicOff + MAGIC.length;
    const binEnd = i + 1 < numEntries ? table[i + 1] : totalLength;
    entries.push({
      entryOffset: off, activityId, marker, name,
      binary: data.subarray(binStart, binEnd),
      rawBlock: data.subarray(off, binEnd),
    });
  }
  return entries;
}

export interface CompiledApp {
  binary: Uint8Array; // bytecode, may or may not carry a leading MAGIC (stripped defensively)
  activityId?: number;
  name?: string;
}

/** Build a full Apps-region image: the directory + every existing entry verbatim + the new
 * app appended last. Exact port of workout_install.build_apps_region. Returns the USED bytes
 * only (caller pads to APPS_REGION_SIZE with 0xFF and writes with extent = this length).
 *
 * `entryType` is the entry header's byte 0 - the rule TYPE from Movescount Android's
 * libkomposti (BinaryAreaAppsConverter::typeMapping: "generic"=0, "guidance"=1). Was
 * hardcoded 0 here (every entry this port ever built was a generic Suunto App); now a real
 * param so a native GUIDED WORKOUT (the [Next]-3s WORKOUT menu, entryType=1 -
 * GuidedWorkoutCore.GUIDANCE_ENTRY_TYPE) can reuse this same builder, matching the desktop
 * tools/workout_install.py signature this ported from. */
export function buildAppsRegion(existingRawBlocks: Uint8Array[], compiled: CompiledApp, entryType = 0): Uint8Array {
  // Strip a leading magic defensively (SuuntoLink's catalog binaries already carry it -
  // Finding 45; a double magic renders "--"). Then prepend our own.
  let binary = compiled.binary;
  if (binary.length >= MAGIC.length && startsWithMagicExact(binary, 0)) binary = binary.subarray(MAGIC.length);

  const activityId = (compiled.activityId ?? 0) & 0xff;
  const marker = entryChecksum(binary);
  const nameBytes = encodeIso(compiled.name ?? 'App', NAME_LEN - 1);
  const nameField = new Array(NAME_LEN).fill(0);
  for (let i = 0; i < nameBytes.length; i++) nameField[i] = nameBytes[i];

  const newBlock = Uint8Array.from([entryType & 0xff, activityId, marker, ...nameField, ...MAGIC, ...binary]);

  const blocks = [...existingRawBlocks, newBlock];
  const numEntries = blocks.length;
  const tableLen = 4 + 4 * (numEntries + 1);

  const offsets: number[] = [];
  let cursor = tableLen;
  for (const block of blocks) { offsets.push(cursor); cursor += block.length; }
  const totalLength = cursor;

  const out = new Uint8Array(totalLength);
  // header
  out[0] = numEntries & 0xff; out[1] = (numEntries >> 8) & 0xff;
  const x = numEntries ^ 0x02; out[2] = x & 0xff; out[3] = (x >> 8) & 0xff;
  let p = 4;
  for (const o of offsets) { writeU32(out, p, o); p += 4; }
  writeU32(out, p, totalLength); p += 4;
  // blocks
  for (const block of blocks) { out.set(block, p); p += block.length; }
  return out;
}

function startsWithMagicExact(b: Uint8Array, off: number): boolean {
  for (let i = 0; i < MAGIC.length; i++) if (b[off + i] !== MAGIC[i]) return false;
  return true;
}
function writeU32(b: Uint8Array, o: number, v: number) {
  b[o] = v & 0xff; b[o + 1] = (v >> 8) & 0xff; b[o + 2] = (v >> 16) & 0xff; b[o + 3] = (v >>> 24) & 0xff;
}
