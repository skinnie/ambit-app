import { base64ToBytes } from './Base64';

// Decodes the Ambit3's real sml.DeviceSettings reply (0x1100) - a curated table of real,
// SuuntoLink-screenshot-visible fields, mirroring the companion research project's
// tools/settings_write.py exactly (same fields, same real entry IDs/enum choices, all
// confirmed live against André's own connected Ambit3 Peak, 2026-08-08 - see that file's
// own docstring and custom_modes_andre.md's "settings write" section for the full story,
// including a real bug found there: entry IDs are assigned per schema descriptor and are
// NOT portable across watches - reusing an ID read from one device's schema against
// another silently hits a different field, with no error at all).
//
// Unlike the desktop tool, this hardcodes the real entry IDs directly rather than parsing
// a schema descriptor file at runtime - Android doesn't ship (and has no use for) the
// SuuntoLink `descr+SERIAL+FW` file the desktop side reads. These IDs were read live off a
// real Ambit3 Peak and are specific to that schema family (Ambit3/Traverse/Ambit2) - not
// assumed to apply to Kailash, whose own real schema is confirmed elsewhere in this
// project to be meaningfully smaller and differently numbered.
//
// Every field here is a plain top-level SBEM entry (id/len/data, no nested GROUP the way
// DeviceHistory's LogHeaders was - see KailashHistoryReader.ts for that shape) - one
// value, one entry, decoded directly.

export type SettingKind = 'bool' | 'enum' | 'number';

export interface SettingChoice {
  value: number;
  label: string;
}

export interface SettingField {
  key: string;
  entryId: number;
  kind: SettingKind;
  // 'bool' -> 1 byte (0/1). 'enum' -> 1 byte, raw integer indexes into `choices`.
  // 'number' -> byteWidth bytes, unsigned unless `signed` is set; 'float' for float32.
  byteWidth: 1 | 4;
  signed?: boolean;
  float?: boolean;
  choices?: SettingChoice[];
}

// Real, live-confirmed 2026-08-08 against André's own Ambit3 Peak - every value below
// matched the real SuuntoLink "General Settings" screenshots exactly once entry IDs were
// derived correctly (assets/ambit3 pcap/v2/general ambit settings/).
export const SETTINGS_FIELDS: SettingField[] = [
  { key: 'date_format', entryId: 0x01, kind: 'enum', byteWidth: 1,
    choices: [{ value: 0, label: 'DDMM' }, { value: 1, label: 'MMDD' }] },
  { key: 'tones', entryId: 0x02, kind: 'enum', byteWidth: 1,
    choices: [{ value: 0, label: 'Buttons off' }, { value: 1, label: 'All on' }, { value: 2, label: 'All off' }] },
  { key: 'gps_position_format', entryId: 0x03, kind: 'enum', byteWidth: 1,
    choices: [
      { value: 0, label: 'WGS84 d' }, { value: 1, label: 'WGS84 dm' }, { value: 2, label: 'WGS84 dms' },
      { value: 3, label: 'UTM' }, { value: 4, label: 'MGRS' }, { value: 5, label: 'British (BNG)' },
      { value: 6, label: 'Finnish (ETRS-TM35FIN)' }, { value: 7, label: 'Finnish (KKJ)' },
      { value: 8, label: 'Irish (IG)' }, { value: 9, label: 'Swedish (RT90)' },
      { value: 10, label: 'Swiss (CH1903)' }, { value: 11, label: 'UTM - NAD27 Alaska' },
      { value: 12, label: 'UTM - NAD27 Conus' }, { value: 13, label: 'UTM - NAD83' },
      { value: 14, label: 'NZTM2000' },
    ] },
  { key: 'compass_declination', entryId: 0x04, kind: 'number', byteWidth: 4, float: true },
  { key: 'button_lock_sport_mode', entryId: 0x05, kind: 'enum', byteWidth: 1,
    choices: [{ value: 0, label: 'All buttons' }, { value: 1, label: 'Actions only' }] },
  { key: 'button_lock_time_mode', entryId: 0x06, kind: 'enum', byteWidth: 1,
    choices: [{ value: 0, label: 'All buttons' }, { value: 1, label: 'Actions only' }] },
  { key: 'units_mode', entryId: 0x07, kind: 'enum', byteWidth: 1,
    choices: [{ value: 0, label: 'Metric' }, { value: 1, label: 'Imperial' }, { value: 2, label: 'Advanced' }] },
  { key: 'language', entryId: 0x11, kind: 'enum', byteWidth: 1,
    choices: [
      { value: 0, label: 'Dansk' }, { value: 1, label: 'Deutsch' }, { value: 2, label: 'English' },
      { value: 3, label: 'Espanol' }, { value: 4, label: 'Francais' }, { value: 5, label: 'Italiano' },
      { value: 6, label: 'Nederlands' }, { value: 7, label: 'Norsk' }, { value: 8, label: 'Portugues' },
      { value: 9, label: 'Suomi' }, { value: 10, label: 'Svenska' }, { value: 11, label: 'Chinese' },
      { value: 12, label: 'Japanese' }, { value: 13, label: 'Korean' }, { value: 14, label: 'Cestina' },
      { value: 15, label: 'Polski' }, { value: 16, label: 'Russian' },
    ] },
  { key: 'time_format', entryId: 0x13, kind: 'enum', byteWidth: 1,
    choices: [{ value: 0, label: '24h' }, { value: 1, label: '12h' }] },
  { key: 'gps_time_keeping', entryId: 0x14, kind: 'enum', byteWidth: 1,
    choices: [{ value: 0, label: 'true' }, { value: 1, label: 'false' }] },
  { key: 'display_contrast', entryId: 0x1f, kind: 'number', byteWidth: 1 },
  { key: 'display_dark', entryId: 0x20, kind: 'bool', byteWidth: 1 },
  { key: 'backlight_mode', entryId: 0x21, kind: 'enum', byteWidth: 1,
    choices: [{ value: 0, label: 'Normal' }, { value: 1, label: 'Off' }, { value: 2, label: 'Night' }, { value: 3, label: 'Toggle' }] },
  { key: 'backlight_brightness', entryId: 0x22, kind: 'number', byteWidth: 1 },
  { key: 'storm_alarm', entryId: 0x27, kind: 'bool', byteWidth: 1 },
];

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

interface SbemEntry { id: number; start: number; end: number }

function sbemEntries(bytes: Uint8Array, start: number): SbemEntry[] {
  const out: SbemEntry[] = [];
  let off = start + 8;
  while (off + 2 <= bytes.length) {
    const id = bytes[off];
    let len = bytes[off + 1];
    off += 2;
    if (len === 0xff) {
      if (off + 4 > bytes.length) break;
      len = (bytes[off] | (bytes[off + 1] << 8) | (bytes[off + 2] << 16) | (bytes[off + 3] << 24)) >>> 0;
      off += 4;
    }
    const end = off + len;
    if (end > bytes.length) break;
    out.push({ id, start: off, end });
    off = end;
  }
  return out;
}

function decodeField(bytes: Uint8Array, entry: SbemEntry, field: SettingField): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset + entry.start, field.byteWidth);
  if (field.float) return view.getFloat32(0, true);
  if (field.byteWidth === 1) return field.signed ? view.getInt8(0) : view.getUint8(0);
  return field.signed ? view.getInt32(0, true) : view.getUint32(0, true);
}

export interface DecodedSetting {
  key: string;
  path: string;
  kind: SettingKind;
  value: number;
  choices?: SettingChoice[];
}

/** Decodes a base64 sml.DeviceSettings reply (see readSettingsRaw() in
 * native/AmbitUsbModule.ts). Returns every SETTINGS_FIELDS entry actually present in this
 * reply - a smaller/different schema (e.g. Kailash, if ever pointed at this decoder by
 * mistake) simply yields fewer rows, not an error, the same "missing is not broken" rule
 * KailashHistoryReader.ts's own decode already follows. */
export function decodeSettings(b64: string): DecodedSetting[] {
  if (!b64) return [];
  const bytes = base64ToBytes(b64);
  const head = findMagic(bytes);
  if (head < 0) return [];

  const entries = sbemEntries(bytes, head);
  const byId = new Map<number, SbemEntry>();
  for (const e of entries) byId.set(e.id, e);

  const out: DecodedSetting[] = [];
  for (const field of SETTINGS_FIELDS) {
    const entry = byId.get(field.entryId);
    if (!entry || entry.end - entry.start < field.byteWidth) continue;
    out.push({
      key: field.key,
      path: `sml.DeviceSettings.${field.key}`,
      kind: field.kind,
      value: decodeField(bytes, entry, field),
      choices: field.choices,
    });
  }
  return out;
}
