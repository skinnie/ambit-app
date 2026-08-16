// Full-fidelity byte-exact codec + create/delete/multisport operations for the Ambit3
// CustomModes region. Direct 1:1 port of the companion project's tools/custom_modes.py
// (decode), tools/custom_modes_write.py (encode) and tools/sport_mode_manage.py (operations).
//
// WHY A SECOND DECODER (this file) rather than reusing CustomModesReader.ts: that one is a
// deliberately LOSSY, display-only decoder - it drops CustomModeID, IntervalSlots, AppMeta,
// SPORT_MODE Order, and the full 138-byte settings body, none of which it needs for the
// edit-a-display UI. Create/delete/multisport change the region STRUCTURE (append/remove
// whole entries and renumber the parallel SPORT_MODES list), so they can only be done by
// decoding the region in full, mutating the tree, and re-encoding it byte-for-byte. This
// codec round-trips: encode(decode(x)) === x for every field the format carries.
//
// PROVEN BYTE-EXACT: __sportModeSelftest below replays André's 2026-08-12 SuuntoLink capture
// (assets/pcap/removeandaddsportsmodeandmultisport, 17 region images / 16 transitions) and
// requires every rebuilt image to match SuuntoLink's own bytes exactly - the same 16/16 the
// Python tool passes. Run by scripts/sportmode_selftest.mjs. This is the only honest proof
// the create/delete rules here are SuuntoLink's and not ours; the writes stay off the watch
// until that passes. (The UI write path is still unproven on hardware until André tests it -
// same standing caveat as CustomModesWriter.ts - but the PAYLOAD is proven identical to what
// SuuntoLink writes.)

import { SPORT_MODE_ROWS, ActivityDefault } from './SportModeRows';

// ─── BXml tag ids (verbatim from custom_modes.py) ─────────────────────────────────────────
const DEVICE_CUSTOM = 0x003;
const EXERCISE_MODES = 0x100;
const EXERCISE_MODES_MODE = 0x101;
const EXERCISE_MODES_SETTING_NAME_LEN64 = 0x103;
const EXERCISE_MODES_DISPLAYS = 0x105;
const EXERCISE_MODES_DISPLAY = 0x106;
const EXERCISE_MODES_DISP_SETTING = 0x107;
const EXERCISE_MODES_DISP_FIELD = 0x108;
const EXERCISE_MODES_DISP_FIELD_SETTING = 0x109;
const EXERCISE_MODES_DISP_FIELD_SHORTCUT = 0x10a;
const EXERCISE_MODES_TYPE = 0x10b;
const EXERCISE_MODES_RULES = 0x10c;
const EXERCISE_MODES_RULE = 0x10d;
const EXERCISE_MODES_APP_META = 0x1ff;
const SPORT_MODES = 0x200;
const SPORT_MODE = 0x210;
const SPORT_MODE_ACTIVITY_ID = 0x213;
const SPORT_MODE_EXERCISE = 0x214;
const SPORT_MODE_SETTING_NAME_LEN64 = 0x215;
const SPORT_MODE_ORDER = 0x2fe;
const SPORT_MODE_APP_META = 0x2ff;

const NAME_SIZE = 64;
const SETTINGS_SIZE = 138; // content length of the settings block, every real mode
const INTERVAL_SLOT_REPEATS = 5;

// SETTING_FIELDS: the fixed uint16 fields after the 64-byte name, in exact order.
const SETTING_FIELDS = [
  'ActivityID', 'CustomModeIdLow', 'CustomModeIdHigh', 'UseHw', 'AltiBaroMode',
  'GpsPowerMode', 'RecordingInterval', 'Autolap', 'HrHigh', 'HrLow', 'HrLimitsUse',
  'AutoStart', 'AutoPause', 'AutoScrolling', 'IntTimerFlags', 'IntTimerCount',
] as const;

export interface IntervalSlot {
  Flags: number; Type: number; MaxLimit: number; MinLimit: number;
  Padding?: number; Len?: number; // only slot 0 (FULL) carries these
}
export interface Settings {
  Name: string;
  ActivityID: number; CustomModeID: number; UseHw: number; AltiBaroMode: number;
  GpsPowerMode: number; RecordingInterval: number; Autolap: number; HrHigh: number;
  HrLow: number; HrLimitsUse: number; AutoStart: number; AutoPause: number;
  AutoScrolling: number; IntTimerFlags: number; IntTimerCount: number;
  IntervalSlots: IntervalSlot[];
}
export interface DispField { Index: number; Type: number; Shortcuts: number[] }
export interface Display { Template: number; Type: number; Fields: DispField[] }
export interface Rule { RuleIdx: number; UseRule: boolean; LogRule: boolean }
export interface AppMeta { Timestamp1: number; Timestamp2: number }
export interface ExerciseMode {
  Settings: Settings; Displays: Display[]; Rules: Rule[]; AppMeta: AppMeta | null;
}
export interface SportSlot {
  Name: string; ActivityID: number; Exercises: number[]; Order: number | null; AppMeta: number | null;
}
export interface DecodedRegion {
  formatType: number; exercise_modes: ExerciseMode[]; sport_modes: SportSlot[];
}

export class LimitError extends Error {} // a rule the watch/SuuntoLink enforces; never written

// ─── little-endian byte helpers ───────────────────────────────────────────────────────────
const u16 = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8);
const u32 = (b: Uint8Array, o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
const pushU16 = (a: number[], v: number) => { a.push(v & 0xff, (v >> 8) & 0xff); };
const pushU32 = (a: number[], v: number) => { a.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff); };

/** [u16 LE tag_id][u16 LE length] + content - the one primitive the whole format is built from. */
function tag(tagId: number, content: number[]): number[] {
  return [tagId & 0xff, (tagId >> 8) & 0xff, content.length & 0xff, (content.length >> 8) & 0xff, ...content];
}
function readTag(b: Uint8Array, o: number): { tagId: number; length: number } | null {
  if (o + 4 > b.length) return null;
  return { tagId: u16(b, o), length: u16(b, o + 2) };
}

// ─── ISO-8859-15 (watch name encoding) ─────────────────────────────────────────────────────
const ISO_TO_UNI: Record<number, number> = {
  0xa4: 0x20ac, 0xa6: 0x0160, 0xa8: 0x0161, 0xb4: 0x017d, 0xb8: 0x017e, 0xbc: 0x0152, 0xbd: 0x0153, 0xbe: 0x0178,
};
const UNI_TO_ISO: Record<number, number> = {
  0x20ac: 0xa4, 0x0160: 0xa6, 0x0161: 0xa8, 0x017d: 0xb4, 0x017e: 0xb8, 0x0152: 0xbc, 0x0153: 0xbd, 0x0178: 0xbe,
};
function decodeName(b: Uint8Array, offset: number, width: number): string {
  let end = offset + width;
  while (end > offset && b[end - 1] === 0) end--;
  let s = '';
  for (let i = offset; i < end; i++) s += String.fromCharCode(ISO_TO_UNI[b[i]] ?? b[i]);
  return s;
}
function encodeNamePadded(name: string, width: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < name.length && out.length < width; i++) {
    const c = name.charCodeAt(i);
    const mapped = UNI_TO_ISO[c];
    out.push(mapped !== undefined ? mapped : (c <= 0xff ? c : 0x3f /* '?' like Python replace */));
  }
  while (out.length < width) out.push(0);
  return out.slice(0, width);
}

// ─── decode ─────────────────────────────────────────────────────────────────────────────
function decodeSettings(b: Uint8Array, offset: number): Settings {
  const name = decodeName(b, offset, NAME_SIZE);
  let cur = offset + NAME_SIZE;
  const raw: Record<string, number> = {};
  for (const f of SETTING_FIELDS) { raw[f] = u16(b, cur); cur += 2; }
  const slots: IntervalSlot[] = [];
  for (let i = 0; i < 1 + INTERVAL_SLOT_REPEATS; i++) {
    if (i === 0) {
      const slot: IntervalSlot = {
        Flags: b[cur], Type: b[cur + 1], MaxLimit: u16(b, cur + 2), MinLimit: u16(b, cur + 4),
        Padding: u16(b, cur + 6), Len: u32(b, cur + 8),
      };
      cur += 12; slots.push(slot);
    } else {
      slots.push({ Flags: b[cur], Type: b[cur + 1], MaxLimit: u16(b, cur + 2), MinLimit: u16(b, cur + 4) });
      cur += 6;
    }
  }
  return {
    Name: name,
    ActivityID: raw.ActivityID,
    CustomModeID: raw.CustomModeIdLow | (raw.CustomModeIdHigh << 16),
    UseHw: raw.UseHw, AltiBaroMode: raw.AltiBaroMode, GpsPowerMode: raw.GpsPowerMode,
    RecordingInterval: raw.RecordingInterval, Autolap: raw.Autolap, HrHigh: raw.HrHigh,
    HrLow: raw.HrLow, HrLimitsUse: raw.HrLimitsUse, AutoStart: raw.AutoStart, AutoPause: raw.AutoPause,
    AutoScrolling: raw.AutoScrolling, IntTimerFlags: raw.IntTimerFlags, IntTimerCount: raw.IntTimerCount,
    IntervalSlots: slots,
  };
}

function decodeDispField(b: Uint8Array, offset: number, length: number): DispField {
  const end = offset + length; let cur = offset;
  const field: DispField = { Index: 0, Type: 0, Shortcuts: [] };
  while (cur < end) {
    const t = readTag(b, cur); if (!t) break; const c = cur + 4;
    if (t.tagId === EXERCISE_MODES_DISP_FIELD_SETTING) { field.Index = u16(b, c); field.Type = u16(b, c + 2); }
    else if (t.tagId === EXERCISE_MODES_DISP_FIELD_SHORTCUT) field.Shortcuts.push(u16(b, c));
    cur = c + t.length;
  }
  return field;
}

function decodeDisplay(b: Uint8Array, offset: number, length: number): Display {
  const end = offset + length; let cur = offset;
  const display: Display = { Template: 0, Type: 0, Fields: [] };
  while (cur < end) {
    const t = readTag(b, cur); if (!t) break; const c = cur + 4;
    if (t.tagId === EXERCISE_MODES_DISP_SETTING) { display.Template = u16(b, c); display.Type = u16(b, c + 2); }
    else if (t.tagId === EXERCISE_MODES_DISP_FIELD) display.Fields.push(decodeDispField(b, c, t.length));
    cur = c + t.length;
  }
  return display;
}

function decodeExerciseMode(b: Uint8Array, offset: number, length: number): ExerciseMode {
  const end = offset + length; let cur = offset;
  const mode: ExerciseMode = { Settings: null as any, Displays: [], Rules: [], AppMeta: null };
  while (cur < end) {
    const t = readTag(b, cur); if (!t) break; const c = cur + 4;
    if (t.tagId === EXERCISE_MODES_SETTING_NAME_LEN64) mode.Settings = decodeSettings(b, c);
    else if (t.tagId === EXERCISE_MODES_APP_META && t.length === 8) mode.AppMeta = { Timestamp1: u32(b, c), Timestamp2: u32(b, c + 4) };
    else if (t.tagId === EXERCISE_MODES_DISPLAYS) {
      let sc = c; const se = c + t.length;
      while (sc < se) { const st = readTag(b, sc); if (!st) break; if (st.tagId === EXERCISE_MODES_DISPLAY) mode.Displays.push(decodeDisplay(b, sc + 4, st.length)); sc = sc + 4 + st.length; }
    } else if (t.tagId === EXERCISE_MODES_RULES) {
      let sc = c; const se = c + t.length;
      while (sc < se) {
        const st = readTag(b, sc); if (!st) break;
        if (st.tagId === EXERCISE_MODES_RULE) mode.Rules.push({ RuleIdx: u16(b, sc + 4), UseRule: !!u16(b, sc + 6), LogRule: !!u16(b, sc + 8) });
        sc = sc + 4 + st.length;
      }
    }
    cur = c + t.length;
  }
  return mode;
}

function decodeSportSlot(b: Uint8Array, offset: number, length: number): SportSlot {
  const end = offset + length; let cur = offset;
  const slot: SportSlot = { Name: '', ActivityID: 0, Exercises: [], Order: null, AppMeta: null };
  while (cur < end) {
    const t = readTag(b, cur); if (!t) break; const c = cur + 4;
    if (t.tagId === SPORT_MODE_SETTING_NAME_LEN64) slot.Name = decodeName(b, c, t.length);
    else if (t.tagId === SPORT_MODE_ACTIVITY_ID) slot.ActivityID = u16(b, c);
    else if (t.tagId === SPORT_MODE_EXERCISE) slot.Exercises.push(u16(b, c));
    else if (t.tagId === SPORT_MODE_ORDER && t.length === 4) slot.Order = u32(b, c);
    else if (t.tagId === SPORT_MODE_APP_META && t.length === 4) slot.AppMeta = u32(b, c);
    cur = c + t.length;
  }
  return slot;
}

/** Decode a raw 12288-byte CustomModes region. Mirrors custom_modes.py decode() exactly. */
export function decode(b: Uint8Array): DecodedRegion {
  const root = readTag(b, 0);
  if (!root || root.tagId !== DEVICE_CUSTOM) throw new Error('expected DEVICE_CUSTOM at offset 0');
  let cur = 4; const end = 4 + root.length;
  const out: DecodedRegion = { formatType: 2, exercise_modes: [], sport_modes: [] };
  while (cur < end) {
    const t = readTag(b, cur); if (!t) break; const c = cur + 4;
    if (t.tagId === EXERCISE_MODES) {
      let sc = c; const se = c + t.length;
      while (sc < se) {
        const st = readTag(b, sc); if (!st) break;
        if (st.tagId === EXERCISE_MODES_TYPE) out.formatType = u16(b, sc + 4);
        else if (st.tagId === EXERCISE_MODES_MODE) out.exercise_modes.push(decodeExerciseMode(b, sc + 4, st.length));
        sc = sc + 4 + st.length;
      }
    } else if (t.tagId === SPORT_MODES) {
      let sc = c; const se = c + t.length;
      while (sc < se) {
        const st = readTag(b, sc); if (!st) break;
        if (st.tagId === SPORT_MODE) out.sport_modes.push(decodeSportSlot(b, sc + 4, st.length));
        sc = sc + 4 + st.length;
      }
    }
    cur = c + t.length;
  }
  return out;
}

// ─── encode (inverse of decode; mirrors custom_modes_write.py) ────────────────────────────
function buildSettings(s: Settings): number[] {
  const body: number[] = encodeNamePadded(s.Name, NAME_SIZE);
  const values: Record<string, number> = {
    ActivityID: s.ActivityID, CustomModeIdLow: s.CustomModeID & 0xffff, CustomModeIdHigh: (s.CustomModeID >> 16) & 0xffff,
    UseHw: s.UseHw, AltiBaroMode: s.AltiBaroMode, GpsPowerMode: s.GpsPowerMode, RecordingInterval: s.RecordingInterval,
    Autolap: s.Autolap, HrHigh: s.HrHigh, HrLow: s.HrLow, HrLimitsUse: s.HrLimitsUse, AutoStart: s.AutoStart,
    AutoPause: s.AutoPause, AutoScrolling: s.AutoScrolling, IntTimerFlags: s.IntTimerFlags, IntTimerCount: s.IntTimerCount,
  };
  for (const f of SETTING_FIELDS) pushU16(body, values[f]);
  if (s.IntervalSlots.length !== 1 + INTERVAL_SLOT_REPEATS) throw new Error(`expected ${1 + INTERVAL_SLOT_REPEATS} interval slots, got ${s.IntervalSlots.length}`);
  s.IntervalSlots.forEach((slot, i) => {
    body.push(slot.Flags & 0xff, slot.Type & 0xff); pushU16(body, slot.MaxLimit); pushU16(body, slot.MinLimit);
    if (i === 0) { pushU16(body, slot.Padding ?? 0); pushU32(body, slot.Len ?? 0); }
  });
  if (body.length !== SETTINGS_SIZE) throw new Error(`settings body is ${body.length} bytes, expected ${SETTINGS_SIZE}`);
  return tag(EXERCISE_MODES_SETTING_NAME_LEN64, body);
}

function buildDispField(field: DispField): number[] {
  const inner: number[] = []; pushU16(inner, field.Index); pushU16(inner, field.Type);
  let body = tag(EXERCISE_MODES_DISP_FIELD_SETTING, inner);
  for (const sc of field.Shortcuts) { const s: number[] = []; pushU16(s, sc); body = body.concat(tag(EXERCISE_MODES_DISP_FIELD_SHORTCUT, s)); }
  return tag(EXERCISE_MODES_DISP_FIELD, body);
}

function buildDisplay(display: Display): number[] {
  const inner: number[] = []; pushU16(inner, display.Template); pushU16(inner, display.Type);
  let body = tag(EXERCISE_MODES_DISP_SETTING, inner);
  for (const f of display.Fields) body = body.concat(buildDispField(f));
  return tag(EXERCISE_MODES_DISPLAY, body);
}

function buildMode(mode: ExerciseMode): number[] {
  let body = buildSettings(mode.Settings);
  if (mode.AppMeta) { const m: number[] = []; pushU32(m, mode.AppMeta.Timestamp1); pushU32(m, mode.AppMeta.Timestamp2); body = body.concat(tag(EXERCISE_MODES_APP_META, m)); }
  // Guarded exactly like the Python encoder: an empty Displays array writes NO tag (SuuntoLink
  // never writes an empty 4-byte DISPLAYS header - see custom_modes_write.build_mode's comment).
  if (mode.Displays.length > 0) {
    let db: number[] = []; for (const d of mode.Displays) db = db.concat(buildDisplay(d));
    body = body.concat(tag(EXERCISE_MODES_DISPLAYS, db));
  }
  if (mode.Rules.length > 0) {
    let rb: number[] = [];
    for (const r of mode.Rules) { const rr: number[] = []; pushU16(rr, r.RuleIdx); pushU16(rr, r.UseRule ? 1 : 0); pushU16(rr, r.LogRule ? 1 : 0); rb = rb.concat(tag(EXERCISE_MODES_RULE, rr)); }
    body = body.concat(tag(EXERCISE_MODES_RULES, rb));
  }
  return tag(EXERCISE_MODES_MODE, body);
}

function buildSportSlot(slot: SportSlot): number[] {
  let body = tag(SPORT_MODE_SETTING_NAME_LEN64, encodeNamePadded(slot.Name, NAME_SIZE));
  const a: number[] = []; pushU16(a, slot.ActivityID); body = body.concat(tag(SPORT_MODE_ACTIVITY_ID, a));
  for (const ex of slot.Exercises) { const e: number[] = []; pushU16(e, ex); body = body.concat(tag(SPORT_MODE_EXERCISE, e)); }
  const o: number[] = []; pushU32(o, slot.Order ?? 0); body = body.concat(tag(SPORT_MODE_ORDER, o));
  if (slot.AppMeta !== null && slot.AppMeta !== undefined) { const m: number[] = []; pushU32(m, slot.AppMeta); body = body.concat(tag(SPORT_MODE_APP_META, m)); }
  return tag(SPORT_MODE, body);
}

/** Inverse of decode(): the DEVICE_CUSTOM-wrapped BXml body (no outer padding). */
export function encodeBody(r: DecodedRegion): Uint8Array {
  let exercise: number[] = []; const ft: number[] = []; pushU16(ft, r.formatType);
  exercise = tag(EXERCISE_MODES_TYPE, ft);
  for (const m of r.exercise_modes) exercise = exercise.concat(buildMode(m));
  let sports: number[] = [];
  for (const s of r.sport_modes) sports = sports.concat(buildSportSlot(s));
  const deviceCustom = tag(EXERCISE_MODES, exercise).concat(tag(SPORT_MODES, sports));
  return Uint8Array.from(tag(DEVICE_CUSTOM, deviceCustom));
}

/** The full region image ready to write: BXml body padded to `regionSize` with 0xFF.
 * (The CustomModes region has no closing hash - the capture's own tail is all 0xFF, proven
 * in the selftest - unlike Routes/Waypoints. Same as what writeCustomModesRaw already writes.) */
export function encodeRegion(r: DecodedRegion, regionSize = 12288): Uint8Array {
  const body = encodeBody(r);
  const out = new Uint8Array(regionSize).fill(0xff);
  out.set(body, 0);
  return out;
}

// ─── fixtures for a freshly created mode (verbatim from sport_mode_manage.py) ──────────────
const HW_SENSOR_SEARCH = 0x0002, HW_HR_BELT = 0x0001, HW_ACCELEROMETER = 0x0004;
const HW_POWER_POD = 0x0040, HW_CADENCE_POD = 0x0080, HW_FOOT_POD = 0x0100, HW_BIKE_POD = 0x0800;
const STAMP_GAP_SECONDS = 2, LINK_GAP_SECONDS = 2;

const NEW_MODE_INTERVAL_SLOTS: IntervalSlot[] = [
  { Flags: 0, Type: 0, MaxLimit: 0, MinLimit: 0, Padding: 0, Len: 0 },
  { Flags: 0, Type: 0, MaxLimit: 0, MinLimit: 0 },
  { Flags: 0, Type: 0, MaxLimit: 0, MinLimit: 0 },
  { Flags: 0, Type: 0, MaxLimit: 0, MinLimit: 0 },
  { Flags: 0, Type: 0, MaxLimit: 0, MinLimit: 0 },
  { Flags: 255, Type: 0, MaxLimit: 255, MinLimit: 0 },
];

// Byte-identical for every newly created mode (SuuntoLink gave "Alpine skiing" and
// "Transition" the same set 342 min apart) - one fixture, not a per-sport table.
const NEW_MODE_DISPLAYS: Display[] = [
  { Template: 260, Type: 10, Fields: [{ Index: 0, Type: 10, Shortcuts: [] }, { Index: 1, Type: 11, Shortcuts: [] }, { Index: 2, Type: 0, Shortcuts: [5] }] },
  { Template: 273, Type: 4, Fields: [{ Index: 0, Type: 8, Shortcuts: [] }, { Index: 1, Type: 8, Shortcuts: [] }, { Index: 2, Type: 0, Shortcuts: [16, 1, 65534] }] },
  { Template: 291, Type: 5, Fields: [{ Index: 0, Type: 8, Shortcuts: [] }, { Index: 1, Type: 40, Shortcuts: [] }, { Index: 2, Type: 0, Shortcuts: [16, 8, 1, 65534] }] },
  { Template: 290, Type: 6, Fields: [{ Index: 0, Type: 24, Shortcuts: [] }, { Index: 1, Type: 25, Shortcuts: [] }, { Index: 2, Type: 0, Shortcuts: [50, 26, 16] }] },
  { Template: 257, Type: 65, Fields: [{ Index: 1, Type: 195, Shortcuts: [] }, { Index: 2, Type: 196, Shortcuts: [] }, { Index: 3, Type: 197, Shortcuts: [] }] },
  { Template: 336, Type: 7, Fields: [] },
  { Template: 260, Type: 50, Fields: [{ Index: 0, Type: 62, Shortcuts: [] }, { Index: 1, Type: 61, Shortcuts: [] }, { Index: 2, Type: 0, Shortcuts: [5, 10, 21, 11, 28] }] },
  { Template: 295, Type: 15, Fields: [{ Index: 0, Type: 162, Shortcuts: [] }, { Index: 1, Type: 161, Shortcuts: [] }, { Index: 2, Type: 160, Shortcuts: [] }] },
];

// ─── catalogue lookups ─────────────────────────────────────────────────────────────────
export interface Limits {
  maxSportModes: number; maxMultisportModes: number; supportsMultisportModes: boolean;
  minLegs: number; maxLegs: number; maxNameLength: number;
}
export function variantLimits(variant = SPORT_MODE_ROWS.defaultVariant): Limits {
  const v = SPORT_MODE_ROWS.variants[variant] || SPORT_MODE_ROWS.variants[SPORT_MODE_ROWS.defaultVariant];
  return {
    maxSportModes: v.maxSportModes, maxMultisportModes: v.maxMultisportModes,
    supportsMultisportModes: v.supportsMultisportModes,
    minLegs: SPORT_MODE_ROWS.limits.minMultisportLegs, maxLegs: SPORT_MODE_ROWS.limits.maxMultisportLegs,
    maxNameLength: 63,
  };
}
function activityDefaults(activityId: number, variant: string): ActivityDefault {
  const per = SPORT_MODE_ROWS.activityDefaults[variant] || SPORT_MODE_ROWS.activityDefaults[SPORT_MODE_ROWS.defaultVariant];
  const d = per[String(activityId)];
  if (!d) throw new LimitError(`activity ${activityId} has no defaults for variant ${variant}`);
  return d;
}
function useHwFor(d: ActivityDefault, accelerometer: boolean): number {
  let mask = HW_SENSOR_SEARCH;
  if (d.hrBelt) mask |= HW_HR_BELT;
  if (accelerometer) mask |= HW_ACCELEROMETER;
  if (d.powerPod) mask |= HW_POWER_POD;
  if (d.cadencePod) mask |= HW_CADENCE_POD;
  if (d.footPod) mask |= HW_FOOT_POD;
  if (d.bikePod) mask |= HW_BIKE_POD;
  return mask;
}

// ─── reading current state ────────────────────────────────────────────────────────────
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));
const isMultisport = (s: SportSlot) => s.Exercises.length > 1;
function exerciseNames(d: DecodedRegion): string[] { return d.exercise_modes.map(m => m.Settings.Name); }
function findExercise(d: DecodedRegion, name: string): number {
  const i = d.exercise_modes.findIndex(m => m.Settings.Name === name);
  if (i < 0) throw new LimitError(`no sport mode named ${JSON.stringify(name)} (have: ${exerciseNames(d).join(', ')})`);
  return i;
}
function findSportMode(d: DecodedRegion, name: string): number {
  const i = d.sport_modes.findIndex(s => s.Name === name);
  if (i < 0) throw new LimitError(`no menu entry named ${JSON.stringify(name)} (have: ${d.sport_modes.map(s => s.Name).join(', ')})`);
  return i;
}
export function counts(d: DecodedRegion): { used: number; multi: number } {
  return { used: d.sport_modes.length, multi: d.sport_modes.filter(isMultisport).length };
}
function usersOf(d: DecodedRegion, exerciseIndex: number): string[] {
  return d.sport_modes.filter(s => isMultisport(s) && s.Exercises.includes(exerciseIndex)).map(s => s.Name);
}
function nextFree(used: Set<number>): number { let n = 1; while (used.has(n)) n++; return n; }
function resolveLegs(d: DecodedRegion, legs: (string | number)[]): number[] {
  return legs.map(leg => {
    if (typeof leg === 'number') {
      if (leg < 0 || leg >= d.exercise_modes.length) throw new LimitError(`leg index ${leg} is outside the mode list`);
      return leg;
    }
    return findExercise(d, leg);
  });
}

function newExerciseMode(name: string, activityId: number, variant: string, modeId: number, accelerometer: boolean, now: number): ExerciseMode {
  const d = activityDefaults(activityId, variant);
  return {
    Displays: [], Rules: [], AppMeta: { Timestamp1: now, Timestamp2: 0 },
    Settings: {
      Name: name, ActivityID: activityId, UseHw: useHwFor(d, accelerometer), AltiBaroMode: d.altiBaroProfile,
      GpsPowerMode: d.gpsInterval, RecordingInterval: d.recordingInterval, Autolap: 0,
      HrHigh: 0, HrLow: 0, HrLimitsUse: 0, AutoStart: 0, AutoPause: 0, AutoScrolling: 0,
      IntTimerFlags: 0, IntTimerCount: 99, CustomModeID: modeId, IntervalSlots: clone(NEW_MODE_INTERVAL_SLOTS),
    },
  };
}

// ─── operations (1:1 with sport_mode_manage.py) ─────────────────────────────────────────
export interface CreateOpts { variant?: string; accelerometer?: boolean; now?: number; linkNow?: number }

/** Add a single sport mode. Returns the THREE region states SuuntoLink writes in order:
 * 1) mode appended, no displays, AppMeta{now,0}; 2) same mode + default displays,
 * AppMeta{now,now+2}; 3) its SPORT_MODES menu entry appended. */
export function createSportMode(decoded: DecodedRegion, name: string, activityId: number, opts: CreateOpts = {}): DecodedRegion[] {
  const variant = opts.variant ?? SPORT_MODE_ROWS.defaultVariant;
  const limits = variantLimits(variant);
  const { used } = counts(decoded);
  if (used >= limits.maxSportModes) throw new LimitError(`${used}/${limits.maxSportModes} sport modes already used - delete one first. Multisport combos count toward this limit too.`);
  if (!name) throw new LimitError('a sport mode needs a name');
  if (utf8len(name) > limits.maxNameLength) throw new LimitError(`name is longer than ${limits.maxNameLength} bytes`);
  if (decoded.exercise_modes.some(m => m.Settings.Name === name)) throw new LimitError(`a sport mode named ${JSON.stringify(name)} already exists`);
  if (SPORT_MODE_ROWS.multisportActivities.includes(activityId)) throw new LimitError(`activity ${activityId} is a multisport container - use create-multisport`);

  const now = Math.floor(opts.now ?? Date.now() / 1000);
  const modeIds = new Set(decoded.exercise_modes.map(m => m.Settings.CustomModeID));
  const orders = new Set(decoded.sport_modes.map(s => s.Order ?? 0));

  const touch = clone(decoded);
  touch.exercise_modes.push(newExerciseMode(name, activityId, variant, nextFree(modeIds), opts.accelerometer ?? false, now));

  const commit = clone(touch);
  const fresh = commit.exercise_modes[commit.exercise_modes.length - 1];
  fresh.Displays = clone(NEW_MODE_DISPLAYS);
  fresh.AppMeta = { Timestamp1: now, Timestamp2: now + STAMP_GAP_SECONDS };

  const link = clone(commit);
  link.sport_modes.push({
    Name: name, ActivityID: activityId, Exercises: [link.exercise_modes.length - 1],
    Order: nextFree(orders),
    AppMeta: opts.linkNow !== undefined ? Math.floor(opts.linkNow) : now + STAMP_GAP_SECONDS + LINK_GAP_SECONDS,
  });
  return [touch, commit, link];
}

/** Remove a single sport mode, decrementing every remaining leg index above it. */
export function deleteSportMode(decoded: DecodedRegion, name: string): DecodedRegion[] {
  const index = findExercise(decoded, name);
  const blocking = usersOf(decoded, index);
  if (blocking.length) throw new LimitError(`${JSON.stringify(name)} is a leg of ${blocking.join(', ')} - delete or edit that multisport mode first`);
  const out = clone(decoded);
  out.exercise_modes.splice(index, 1);
  out.sport_modes = out.sport_modes.filter(s => !(s.Exercises.length === 1 && s.Exercises[0] === index));
  for (const s of out.sport_modes) s.Exercises = s.Exercises.map(i => (i > index ? i - 1 : i));
  return [out];
}

export interface MultiOpts { variant?: string; now?: number }

/** Add a multisport combo - a pure SPORT_MODES entry whose legs point at existing modes. */
export function createMultisport(decoded: DecodedRegion, name: string, activityId: number, legs: (string | number)[], opts: MultiOpts = {}): DecodedRegion[] {
  const variant = opts.variant ?? SPORT_MODE_ROWS.defaultVariant;
  const limits = variantLimits(variant);
  if (!limits.supportsMultisportModes) throw new LimitError(`${variant} has no multisport modes`);
  const { used, multi } = counts(decoded);
  if (multi >= limits.maxMultisportModes) throw new LimitError(`${multi}/${limits.maxMultisportModes} multisport modes already used - delete one first`);
  if (used >= limits.maxSportModes) throw new LimitError(`${used}/${limits.maxSportModes} sport modes already used - a multisport mode needs one of those slots too`);
  if (!SPORT_MODE_ROWS.multisportActivities.includes(activityId)) throw new LimitError(`activity ${activityId} cannot hold several sports; pick one of ${SPORT_MODE_ROWS.multisportActivities.join(', ')} (Multisport, Triathlon, Adventure racing)`);
  if (!name) throw new LimitError('a multisport mode needs a name');
  if (utf8len(name) > limits.maxNameLength) throw new LimitError(`name is longer than ${limits.maxNameLength} bytes`);
  if (decoded.sport_modes.some(s => s.Name === name)) throw new LimitError(`a mode named ${JSON.stringify(name)} already exists`);

  const resolved = resolveLegs(decoded, legs);
  if (resolved.length < limits.minLegs || resolved.length > limits.maxLegs) throw new LimitError(`a multisport mode takes ${limits.minLegs} to ${limits.maxLegs} sports, not ${resolved.length}`);

  const now = Math.floor(opts.now ?? Date.now() / 1000);
  const out = clone(decoded);
  out.sport_modes.push({ Name: name, ActivityID: activityId, Exercises: resolved, Order: nextFree(new Set(out.sport_modes.map(s => s.Order ?? 0))), AppMeta: now });
  return [out];
}

export interface EditOpts { variant?: string; newName?: string; activityId?: number; legs?: (string | number)[]; now?: number }
export function editMultisport(decoded: DecodedRegion, name: string, opts: EditOpts = {}): DecodedRegion[] {
  const variant = opts.variant ?? SPORT_MODE_ROWS.defaultVariant;
  const limits = variantLimits(variant);
  const index = findSportMode(decoded, name);
  if (!isMultisport(decoded.sport_modes[index])) throw new LimitError(`${JSON.stringify(name)} is a single sport mode, not a multisport mode`);
  const out = clone(decoded);
  const target = out.sport_modes[index];
  if (opts.newName !== undefined) {
    if (utf8len(opts.newName) > limits.maxNameLength) throw new LimitError(`name is longer than ${limits.maxNameLength} bytes`);
    if (out.sport_modes.some((s, i) => i !== index && s.Name === opts.newName)) throw new LimitError(`a mode named ${JSON.stringify(opts.newName)} already exists`);
    target.Name = opts.newName;
  }
  if (opts.activityId !== undefined) {
    if (!SPORT_MODE_ROWS.multisportActivities.includes(opts.activityId)) throw new LimitError(`activity ${opts.activityId} cannot hold several sports`);
    target.ActivityID = opts.activityId;
  }
  if (opts.legs !== undefined) {
    const resolved = resolveLegs(out, opts.legs);
    if (resolved.length < limits.minLegs || resolved.length > limits.maxLegs) throw new LimitError(`a multisport mode takes ${limits.minLegs} to ${limits.maxLegs} sports, not ${resolved.length}`);
    target.Exercises = resolved;
  }
  target.AppMeta = Math.floor(opts.now ?? Date.now() / 1000);
  return [out];
}

/** Remove a multisport combo. Only the SPORT_MODES entry goes; its legs stay as their own modes. */
export function deleteMultisport(decoded: DecodedRegion, name: string): DecodedRegion[] {
  const index = findSportMode(decoded, name);
  if (!isMultisport(decoded.sport_modes[index])) throw new LimitError(`${JSON.stringify(name)} is a single sport mode - use delete`);
  const out = clone(decoded);
  out.sport_modes.splice(index, 1);
  return [out];
}

function utf8len(s: string): number { let n = 0; for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); n += c < 0x80 ? 1 : c < 0x800 ? 2 : 3; } return n; }

// A menu-ordered summary for the UI, mirroring sport_mode_manage.describe()'s data.
export interface ModeSummary { order: number; name: string; activityId: number; multisport: boolean; legs: string[]; usedBy: string[] }
export function summarise(d: DecodedRegion): { used: number; maxUsed: number; multi: number; maxMulti: number; modes: ModeSummary[] } {
  const limits = variantLimits();
  const { used, multi } = counts(d);
  const names = exerciseNames(d);
  const modes = [...d.sport_modes].sort((a, b) => (a.Order ?? 0) - (b.Order ?? 0)).map(s => ({
    order: s.Order ?? 0, name: s.Name, activityId: s.ActivityID, multisport: isMultisport(s),
    legs: isMultisport(s) ? s.Exercises.map(i => names[i]) : [],
    usedBy: isMultisport(s) ? [] : usersOf(d, s.Exercises[0]),
  }));
  return { used, maxUsed: limits.maxSportModes, multi, maxMulti: limits.maxMultisportModes, modes };
}
