import { readSettingsRaw, writeSettingsRaw } from '../native/AmbitUsbModule';
import { base64ToBytes, bytesToBase64 } from './Base64';
import { SettingField, decodeSettings } from './AmbitSettingsReader';

// Real, hardware-confirmed write dance, 2026-08-08: read the full settings blob fresh,
// patch exactly the bytes for one field (found by its real entry ID, from whichever field
// table the caller passes - AMBIT3_SETTINGS_FIELDS or KAILASH_SETTINGS_FIELDS, never a
// cached/assumed byte offset), write the whole blob back, and re-read to confirm - mirrors
// the companion research project's tools/settings_write.py's own write_one() exactly,
// including its "prove it, don't just trust the ACK" standard: `ok` here is only true
// once a fresh re-read actually shows the new value, not just because the native write
// call itself didn't throw.

const MAGIC = [0x53, 0x42, 0x45, 0x4d, 0x30, 0x31, 0x30, 0x32]; // "SBEM0102"

function findMagic(bytes: Uint8Array): number {
  for (let i = 0; i + MAGIC.length <= bytes.length; i++) {
    let match = true;
    for (let j = 0; j < MAGIC.length; j++) {
      if (bytes[i + j] !== MAGIC[j]) { match = false; break; }
    }
    if (match) return i;
  }
  return -1;
}

/** Real byte offset of `field`'s own entry within this specific reply - walked fresh every
 * time, the same defensive principle settings_write.py's own write_one() uses, so a stale
 * offset from an earlier read (or, worse, another device's schema) can never be reused by
 * accident. Returns the entry's own start plus `field.byteOffset` (0 for every field
 * except a packed multi-value entry like Kailash's HomeLocation - see
 * AmbitSettingsReader.ts's own SettingField comment). Returns null if the entry isn't in
 * this reply at all, or is too short for byteOffset + byteWidth. */
function findFieldOffset(bytes: Uint8Array, field: SettingField): number | null {
  const head = findMagic(bytes);
  if (head < 0) return null;
  let off = head + 8;
  const need = (field.byteOffset ?? 0) + field.byteWidth;
  while (off + 2 <= bytes.length) {
    const id = bytes[off];
    let len = bytes[off + 1];
    off += 2;
    if (len === 0xff) {
      if (off + 4 > bytes.length) break;
      len = (bytes[off] | (bytes[off + 1] << 8) | (bytes[off + 2] << 16) | (bytes[off + 3] << 24)) >>> 0;
      off += 4;
    }
    if (id === field.entryId) {
      return len >= need ? off + (field.byteOffset ?? 0) : null;
    }
    off += len;
  }
  return null;
}

function encodeField(bytes: Uint8Array, offset: number, field: SettingField, value: number): void {
  const raw = field.scale ? Math.round(value * field.scale) : value;
  const view = new DataView(bytes.buffer, bytes.byteOffset + offset, field.byteWidth);
  if (field.float) { view.setFloat32(0, raw, true); return; }
  if (field.byteWidth === 1) { (field.signed ? view.setInt8 : view.setUint8).call(view, 0, raw); return; }
  (field.signed ? view.setInt32 : view.setUint32).call(view, 0, raw, true);
}

export interface WriteSettingResult {
  ok: boolean;
  key: string;
  previousValue: number | null;
  requestedValue: number;
  confirmedValue: number | null;
  error?: string;
}

/** Real write: reads the current settings blob, patches one field, writes it back, and
 * re-reads to confirm. `fields` must be the same table (AMBIT3_SETTINGS_FIELDS or
 * KAILASH_SETTINGS_FIELDS) the caller used to decode the row it's writing back - the same
 * per-device table discipline settings_write.py's own settings_table(product_id) enforces
 * on the desktop side. `value` is the enum's own raw integer / the number's own value -
 * never a display label. Rejects only on a genuine transport error (native write
 * throwing, or the watch never answering the read-back at all); a write that goes through
 * but doesn't stick resolves with `ok: false`, matching write_one()'s own contract. */
export async function writeSetting(
  key: string,
  value: number,
  fields: SettingField[],
): Promise<WriteSettingResult> {
  const field = fields.find(f => f.key === key);
  if (!field) {
    return { ok: false, key, previousValue: null, requestedValue: value, confirmedValue: null,
      error: `unknown setting ${key}` };
  }
  // Real, hardware-independent range check, same bounds settings_write.py's own
  // write_one() enforces before ever sending a byte - a coordinate typo (e.g. a stray
  // digit making a 500-degree latitude) should never even reach the watch.
  if (key === 'home_latitude' && (value < -90 || value > 90)) {
    return { ok: false, key, previousValue: null, requestedValue: value, confirmedValue: null,
      error: `${key}=${value} out of range [-90, 90]` };
  }
  if (key === 'home_longitude' && (value < -180 || value > 180)) {
    return { ok: false, key, previousValue: null, requestedValue: value, confirmedValue: null,
      error: `${key}=${value} out of range [-180, 180]` };
  }

  const beforeB64 = await readSettingsRaw();
  const before = base64ToBytes(beforeB64);
  const offset = findFieldOffset(before, field);
  if (offset === null) {
    return { ok: false, key, previousValue: null, requestedValue: value, confirmedValue: null,
      error: `entry 0x${field.entryId.toString(16)} (${key}) not in this watch's current settings reply` };
  }
  const previousView = new DataView(before.buffer, before.byteOffset + offset, field.byteWidth);
  const previousRaw = field.float ? previousView.getFloat32(0, true)
    : field.byteWidth === 1 ? (field.signed ? previousView.getInt8(0) : previousView.getUint8(0))
    : (field.signed ? previousView.getInt32(0, true) : previousView.getUint32(0, true));
  const previousValue = field.scale ? previousRaw / field.scale : previousRaw;

  const modified = new Uint8Array(before);
  encodeField(modified, offset, field, value);
  await writeSettingsRaw(bytesToBase64(modified));

  const after = decodeSettings(await readSettingsRaw(), fields);
  const confirmed = after.find(s => s.key === key);
  const confirmedValue = confirmed ? confirmed.value : null;

  // Real precision pitfall, found while verifying this exact change: a scaled field
  // (home_latitude/home_longitude) can only round-trip 7 decimal digits - any real user
  // input with more precision than that gets legitimately rounded by the raw int32
  // encoding, so comparing confirmedValue directly against the caller's own unrounded
  // `value` would report `ok: false` on nearly every real write even though it landed
  // exactly as precisely as the format allows. Compare on the same rounded-to-raw
  // representation both sides actually went through instead - mirrors
  // settings_write.py's own write_one(), which compares confirmed_raw against
  // raw_new_value (integers), never the display-scaled floats.
  const requestedRaw = field.scale ? Math.round(value * field.scale) : value;
  const confirmedRaw = confirmedValue !== null
    ? (field.scale ? Math.round(confirmedValue * field.scale) : confirmedValue)
    : null;

  return {
    ok: confirmedRaw === requestedRaw,
    key,
    previousValue,
    requestedValue: value,
    confirmedValue,
  };
}
