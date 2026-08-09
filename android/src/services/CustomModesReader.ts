// Decodes the Ambit3 CustomModes flash region (sport modes) - a third, distinct on-device
// encoding besides fixed-stride binary records (Routes/Waypoints/GpsSGEE) and SBEM0102
// (DeviceSettings/POIs/ActivityTracking): Suunto's own "BXml" binary-encoded tree format.
// Every tag is a 4-byte header - [u16 LE tag_id][u16 LE length] - followed by that many
// content bytes, which may themselves be further nested tags.
//
// This is a direct TS port of the companion research project's tools/custom_modes.py,
// reverse-engineered 2026-08-05 (see custom_modes_andre.md for the full derivation). Tag
// IDs, FIELD_TYPES and SETTING_FIELDS below are copied verbatim from that file - not
// re-derived - to avoid any risk of silent divergence between the two decoders.

export const DEVICE_CUSTOM = 0x003;
export const EXERCISE_MODES = 0x100;
export const EXERCISE_MODES_MODE = 0x101;
export const EXERCISE_MODES_SETTING_NAME_LEN64 = 0x103;
export const EXERCISE_MODES_DISPLAYS = 0x105;
export const EXERCISE_MODES_DISPLAY = 0x106;
export const EXERCISE_MODES_DISP_SETTING = 0x107;
export const EXERCISE_MODES_DISP_FIELD = 0x108;
export const EXERCISE_MODES_DISP_FIELD_SETTING = 0x109;
export const EXERCISE_MODES_DISP_FIELD_SHORTCUT = 0x10A;
export const EXERCISE_MODES_TYPE = 0x10B;
export const EXERCISE_MODES_RULES = 0x10C;
export const EXERCISE_MODES_RULE = 0x10D;
export const SPORT_MODES = 0x200;
export const SPORT_MODE = 0x210;
export const SPORT_MODE_ACTIVITY_ID = 0x213;
export const SPORT_MODE_EXERCISE = 0x214;
export const SPORT_MODE_SETTING_NAME_LEN64 = 0x215;

// BXmlIdMapping - the leaf field-type / screen-template dictionary, reproduced verbatim
// from custom_modes.py's own FIELD_TYPES (95 entries, generated programmatically from that
// file rather than hand-copied, to rule out transcription errors).
export const FIELD_TYPES: { value: number; name: string }[] = [
  { value: 0, name: "FT_SHORTCUT" }, { value: 1, name: "FT_TIME" }, { value: 2, name: "FT_TIME_SEC" },
  { value: 3, name: "FT_DATE" }, { value: 4, name: "FT_WEEKDAY" }, { value: 5, name: "FT_TIMER" },
  { value: 6, name: "FT_ALTI" }, { value: 7, name: "FT_BARO" }, { value: 8, name: "FT_COMPASS" },
  { value: 9, name: "FT_HEART_RATE_AVG" }, { value: 10, name: "FT_DISTANCE" }, { value: 11, name: "FT_VELOCITY" },
  { value: 12, name: "FT_AVGSPEED" }, { value: 13, name: "FT_TEMPERATURE" }, { value: 14, name: "FT_BARO_GRAPH" },
  { value: 15, name: "FT_ALTI_GRAPH" }, { value: 16, name: "FT_COMPASSCARDINAL" }, { value: 17, name: "FT_TOTAL_CALORIES" },
  { value: 18, name: "FT_REF_ALTI" }, { value: 19, name: "FT_ENERGY_SYMBOL" }, { value: 20, name: "FT_HEART_RATE_PEAK" },
  { value: 21, name: "FT_HEART_RATE_CURR" }, { value: 22, name: "FT_HEART_RATE_GRAPH" }, { value: 23, name: "FT_CADENCE" },
  { value: 24, name: "FT_NAVI_ARROW" }, { value: 25, name: "FT_NAVI_DISTANCE" }, { value: 26, name: "FT_NAVI_DIRECTION" },
  { value: 27, name: "FT_DUAL_TIME" }, { value: 28, name: "FT_PACE" }, { value: 29, name: "FT_AVG_PACE" },
  { value: 30, name: "FT_RECOVERY_TIME" }, { value: 31, name: "FT_TE" }, { value: 32, name: "FT_EXERCISE_ALTI_GRAPH" },
  { value: 51, name: "FT_RULE_ENGINE_0" }, { value: 52, name: "FT_RULE_ENGINE_1" }, { value: 53, name: "FT_RULE_ENGINE_2" },
  { value: 54, name: "FT_STOPWATCH_ABC" }, { value: 55, name: "FT_SW_ABC_LAP_TIME" }, { value: 56, name: "FT_SW_ABC_LAP" },
  { value: 57, name: "FT_SW_TIME" }, { value: 58, name: "FT_DEVELOPER_TITLE" }, { value: 59, name: "FT_TEXT_ADJUST" },
  { value: 60, name: "FT_CALIBRATED_DISTANCE" }, { value: 61, name: "FT_INTERVAL_VALUE" }, { value: 62, name: "FT_INTERVAL_TITLE" },
  { value: 63, name: "FT_SPLIT_LAP_DISTANCE" }, { value: 64, name: "FT_SWIM_STYLE_TITLE" }, { value: 66, name: "FT_DRILL_TITLE" },
  { value: 68, name: "FT_BATTERY_CHARGE" }, { value: 70, name: "FT_SPORT_LAP_STOPWATCH" }, { value: 72, name: "FT_SPORT_LAP_AVGSPEED" },
  { value: 74, name: "FT_BIKE_POWER_AVG" }, { value: 76, name: "FT_BIKE_POWER_10S" }, { value: 78, name: "FT_BIKE_POWER_LAP" },
  { value: 80, name: "FT_BIKE_POWER_LAP_MAX" }, { value: 82, name: "FT_SWIM_STYLE" }, { value: 84, name: "FT_SWIM_STROKES" },
  { value: 86, name: "FT_SWIM_PACE" }, { value: 88, name: "FT_SWIM_AVG_PACE" }, { value: 90, name: "FT_SWIM_LAP_DISTANCE" },
  { value: 92, name: "FT_SWIM_LAP_RATE" }, { value: 94, name: "FT_SWIM_LAP_SWOLF" }, { value: 96, name: "FT_SWIM_POOL_STROKES" },
  { value: 98, name: "FT_SWIM_POOL_PACE" }, { value: 100, name: "FT_SWIM_INT_TIME" }, { value: 102, name: "FT_SWIM_INT_STROKES" },
  { value: 104, name: "FT_SWIM_INT_PACE" }, { value: 106, name: "FT_SWIM_REST_TIME" }, { value: 256, name: "PID_RUNNER_GPS_TEMPLATE_1" },
  { value: 257, name: "PID_RUNNER_GPS_TEMPLATE_1G_GRAPH" }, { value: 258, name: "PID_RUNNER_GPS_TEMPLATE_2" }, { value: 259, name: "PID_RUNNER_GPS_TEMPLATE_3" },
  { value: 260, name: "PID_RUNNER_GPS_TEMPLATE_4" }, { value: 261, name: "PID_RUNNER_GPS_TEMPLATE_5" }, { value: 262, name: "PID_RUNNER_GPS_TEMPLATE_6" },
  { value: 263, name: "PID_RUNNER_GPS_TEMPLATE_7_WAYPOINT" }, { value: 264, name: "PID_RUNNER_GPS_TEMPLATE_8_LOCATION" }, { value: 265, name: "PID_RUNNER_GPS_TEMPLATE_9_WAYPOINT_NAME" },
  { value: 272, name: "PID_RUNNER_GPS_TEMPLATE_10_INPUT" }, { value: 273, name: "PID_RUNNER_GPS_TEMPLATE_11_COMPASS_NAVIGATE" }, { value: 274, name: "PID_RUNNER_GPS_TEMPLATE_12_SETTINGS" },
  { value: 275, name: "PID_RUNNER_GPS_TEMPLATE_13_TWOWAY_CHOICE" }, { value: 276, name: "PID_RUNNER_GPS_TEMPLATE_14_ONEWAY_CHOICE" }, { value: 277, name: "PID_RUNNER_GPS_TEMPLATE_15_ADJUST" },
  { value: 278, name: "PID_RUNNER_GPS_TEMPLATE_16_LOADING" }, { value: 279, name: "PID_RUNNER_GPS_TEMPLATE_17_POPUP" }, { value: 280, name: "PID_RUNNER_GPS_TEMPLATE_18_MEMORY" },
  { value: 281, name: "PID_RUNNER_GPS_TEMPLATE_19_MODE_TITLE" }, { value: 288, name: "PID_RUNNER_GPS_TEMPLATE_20_CALIBRATION" }, { value: 289, name: "PID_RUNNER_GPS_TEMPLATE_21_UTMMGRS_LOCATION" },
  { value: 290, name: "PID_RUNNER_GPS_TEMPLATE_22_NAVIGATION" }, { value: 291, name: "PID_RUNNER_GPS_TEMPLATE_11_MILS_COMPASS_NAVIGATE" }, { value: 336, name: "PID_RUNNER_GPS_TEMPLATE_50_MAP_DRAW" },
  { value: 512, name: "PID_RUNNER_GPS_TEMPLATE_100_DEBUG" }, { value: 65534, name: "MT_NONE" },
];

export const FIELD_TYPE_NAMES: Map<number, string> = new Map(FIELD_TYPES.map(f => [f.value, f.name]));
export const FIELD_TYPE_VALUES: Map<string, number> = new Map(FIELD_TYPES.map(f => [f.name, f.value]));

export function fieldTypeName(value: number): string {
  // Real bug, found 2026-08-09 while verifying numberDisplays() against a real capture:
  // custom_modes.py's own fallback is `f"0x{tpl:04x}"` (zero-padded to 4 hex digits, e.g.
  // "0x0127") - this was unpadded ("0x127"), which is why GPS_SYSTEM_TAIL/NON_GPS_SYSTEM_TAIL
  // (both end in the literal string "0x0127") never matched and isBuiltIn was always false.
  // Also a real, pre-existing display bug on its own: any screen using an unconfirmed
  // template showed "0x127" instead of desktop's "0x0127".
  return FIELD_TYPE_NAMES.get(value) ?? `0x${value.toString(16).padStart(4, '0')}`;
}

// Real, 2026-08-09 ("on custom sports it shows the variable names, can't we have the normal
// names?") - direct port of tools/custom_modes.py's own FIELD_TYPE_LABELS, curated by hand
// for every real FT_* entry (not a mechanical guess). Two are hardware-confirmed real names
// from this project's own live testing: FT_VELOCITY really does show as "Speed" and
// FT_HEART_RATE_CURR really does show as "Heart Rate" (custom_modes_andre.md). Same real
// fix desktop's DataPickerDialog.qml/SportModesPage.qml already got - Android's own
// SportModesScreen.tsx was still showing raw enum names until now.
export const FIELD_TYPE_LABELS: Record<string, string> = {
  FT_SHORTCUT: 'Shortcut', FT_TIME: 'Time', FT_TIME_SEC: 'Time (with seconds)',
  FT_DATE: 'Date', FT_WEEKDAY: 'Weekday', FT_TIMER: 'Timer', FT_ALTI: 'Altitude',
  FT_BARO: 'Barometric Pressure', FT_COMPASS: 'Compass Heading',
  FT_HEART_RATE_AVG: 'Heart Rate (average)', FT_DISTANCE: 'Distance',
  FT_VELOCITY: 'Speed', FT_AVGSPEED: 'Speed (average)', FT_TEMPERATURE: 'Temperature',
  FT_BARO_GRAPH: 'Barometric Pressure Graph', FT_ALTI_GRAPH: 'Altitude Graph',
  FT_COMPASSCARDINAL: 'Compass Direction', FT_TOTAL_CALORIES: 'Calories',
  FT_REF_ALTI: 'Reference Altitude', FT_ENERGY_SYMBOL: 'Energy Level',
  FT_HEART_RATE_PEAK: 'Heart Rate (peak)', FT_HEART_RATE_CURR: 'Heart Rate',
  FT_HEART_RATE_GRAPH: 'Heart Rate Graph', FT_CADENCE: 'Cadence',
  FT_NAVI_ARROW: 'Navigation Arrow', FT_NAVI_DISTANCE: 'Navigation Distance',
  FT_NAVI_DIRECTION: 'Navigation Direction', FT_DUAL_TIME: 'Dual Time',
  FT_PACE: 'Pace', FT_AVG_PACE: 'Pace (average)', FT_RECOVERY_TIME: 'Recovery Time',
  FT_TE: 'Training Effect', FT_EXERCISE_ALTI_GRAPH: 'Altitude Graph (exercise)',
  FT_RULE_ENGINE_0: 'Suunto App Slot 1', FT_RULE_ENGINE_1: 'Suunto App Slot 2',
  FT_RULE_ENGINE_2: 'Suunto App Slot 3', FT_STOPWATCH_ABC: 'Stopwatch',
  FT_SW_ABC_LAP_TIME: 'Stopwatch Lap Time', FT_SW_ABC_LAP: 'Stopwatch Lap',
  FT_SW_TIME: 'Stopwatch Time', FT_DEVELOPER_TITLE: 'Developer Title',
  FT_TEXT_ADJUST: 'Text Adjust', FT_CALIBRATED_DISTANCE: 'Distance (calibrated)',
  FT_INTERVAL_VALUE: 'Interval Value', FT_INTERVAL_TITLE: 'Interval Title',
  FT_SPLIT_LAP_DISTANCE: 'Split/Lap Distance', FT_SWIM_STYLE_TITLE: 'Swim Style Title',
  FT_DRILL_TITLE: 'Drill Title', FT_BATTERY_CHARGE: 'Battery Charge',
  FT_SPORT_LAP_STOPWATCH: 'Lap Stopwatch', FT_SPORT_LAP_AVGSPEED: 'Lap Average Speed',
  FT_BIKE_POWER_AVG: 'Bike Power (average)', FT_BIKE_POWER_10S: 'Bike Power (10s average)',
  FT_BIKE_POWER_LAP: 'Bike Power (lap average)', FT_BIKE_POWER_LAP_MAX: 'Bike Power (lap max)',
  FT_SWIM_STYLE: 'Swim Style', FT_SWIM_STROKES: 'Swim Strokes', FT_SWIM_PACE: 'Swim Pace',
  FT_SWIM_AVG_PACE: 'Swim Pace (average)', FT_SWIM_LAP_DISTANCE: 'Swim Lap Distance',
  FT_SWIM_LAP_RATE: 'Swim Stroke Rate', FT_SWIM_LAP_SWOLF: 'Swim SWOLF',
  FT_SWIM_POOL_STROKES: 'Pool Swim Strokes', FT_SWIM_POOL_PACE: 'Pool Swim Pace',
  FT_SWIM_INT_TIME: 'Swim Interval Time', FT_SWIM_INT_STROKES: 'Swim Interval Strokes',
  FT_SWIM_INT_PACE: 'Swim Interval Pace', FT_SWIM_REST_TIME: 'Swim Rest Time',
  MT_NONE: '(none)',
};

const PID_PREFIX = 'PID_RUNNER_GPS_TEMPLATE_';

/** Human-readable label for a real field-type name - the curated dict above, or a
 * real-but-honest fallback for the PID_RUNNER_GPS_TEMPLATE_* screen-template entries this
 * project has never confirmed the visual meaning of: strips the common prefix and reformats
 * the enum's own real suffix, without inventing new meaning. Direct port of
 * custom_modes.py's own field_type_label(). */
export function fieldTypeLabel(name: string): string {
  if (name in FIELD_TYPE_LABELS) return FIELD_TYPE_LABELS[name];
  if (name.startsWith(PID_PREFIX)) {
    const rest = name.slice(PID_PREFIX.length);
    const sepIndex = rest.indexOf('_');
    const num = sepIndex === -1 ? rest : rest.slice(0, sepIndex);
    const words = sepIndex === -1 ? '' : rest.slice(sepIndex + 1);
    const pretty = words
      .split('_')
      .filter(Boolean)
      .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join(' ');
    return `Screen ${num}` + (pretty ? ` - ${pretty}` : '');
  }
  return name;
}

// EXERCISE_MODES_SETTING_NAME_LEN64's content: a 64-byte Name field, then this fixed
// sequence of uint16 fields (all "<H" in custom_modes.py's own SETTING_FIELDS) - copied
// verbatim, same order, same names, so a UI built against this can round-trip against the
// desktop's own write tools without a second name-mapping layer.
export const SETTING_FIELD_NAMES = [
  'ActivityID', 'CustomModeIdLow', 'CustomModeIdHigh', 'UseHw', 'AltiBaroMode',
  'GpsPowerMode', 'RecordingInterval', 'Autolap', 'HrHigh', 'HrLow', 'HrLimitsUse',
  'AutoStart', 'AutoPause', 'AutoScrolling', 'IntTimerFlags', 'IntTimerCount',
] as const;
export type SettingFieldName = typeof SETTING_FIELD_NAMES[number];

export const NAME_FIELD_WIDTH = 64;

/** {fieldName: byteOffset within the settings block} - offset 0 is the start of the
 * 64-byte Name field itself. Every field here is a uint16 (2 bytes), so this is simply
 * 64 + 2*index - computed from SETTING_FIELD_NAMES' own declared order, not hardcoded,
 * matching custom_modes_field_write_test.py's own field_offsets(). */
export const SETTING_FIELD_OFFSETS: Record<string, number> = Object.fromEntries(
  SETTING_FIELD_NAMES.map((name, i) => [name, NAME_FIELD_WIDTH + i * 2]),
);

interface Tag { tagId: number; length: number }

/** A single BXml tag header: [u16 LE tag_id][u16 LE length], content follows. */
export function readTag(bytes: Uint8Array, offset: number): Tag | null {
  if (offset + 4 > bytes.length) return null;
  const tagId = bytes[offset] | (bytes[offset + 1] << 8);
  const length = bytes[offset + 2] | (bytes[offset + 3] << 8);
  return { tagId, length };
}

// ISO-8859-15 (not plain ISO-8859-1 / Latin-1): CustomModes names are encoded this way on
// the watch. Differs from Latin-1 at exactly 8 code points (the euro sign and a handful of
// accented letters) - everything else is a direct byte<->code-point mapping.
const ISO8859_15_TO_UNICODE: Record<number, number> = {
  0xA4: 0x20AC, 0xA6: 0x0160, 0xA8: 0x0161, 0xB4: 0x017D,
  0xB8: 0x017E, 0xBC: 0x0152, 0xBD: 0x0153, 0xBE: 0x0178,
};

export function decodeIso885915(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(ISO8859_15_TO_UNICODE[b] ?? b);
  return s;
}

function decodeNameField(bytes: Uint8Array, offset: number, width: number): string {
  let end = offset + width;
  while (end > offset && bytes[end - 1] === 0) end--;
  return decodeIso885915(bytes.subarray(offset, end));
}

export interface ExerciseModeSettings {
  name: string;
  activityId: number;
  useHw: number;
  altiBaroMode: number;
  recordingInterval: number;
  autolap: number;
  hrHigh: number;
  hrLow: number;
  hrLimitsUse: number;
}

function decodeSettings(bytes: Uint8Array, offset: number): ExerciseModeSettings {
  const name = decodeNameField(bytes, offset, NAME_FIELD_WIDTH);
  const at = (field: string) => offset + SETTING_FIELD_OFFSETS[field];
  const u16 = (o: number) => bytes[o] | (bytes[o + 1] << 8);
  return {
    name,
    activityId: u16(at('ActivityID')),
    useHw: u16(at('UseHw')),
    altiBaroMode: u16(at('AltiBaroMode')),
    recordingInterval: u16(at('RecordingInterval')),
    autolap: u16(at('Autolap')),
    hrHigh: u16(at('HrHigh')),
    hrLow: u16(at('HrLow')),
    hrLimitsUse: u16(at('HrLimitsUse')),
  };
}

export interface DisplayField {
  index: number;
  indexName: string;
  type: number;
  typeName: string;
  // Real, 2026-08-09 - human-readable label (fieldTypeLabel(typeName)), same real fix
  // desktop's DataPickerDialog.qml already has.
  typeLabel: string;
}

function decodeDispField(bytes: Uint8Array, offset: number, length: number): DisplayField {
  const end = offset + length;
  let cursor = offset;
  const field: DisplayField = {
    index: 0, indexName: fieldTypeName(0), type: 0, typeName: fieldTypeName(0),
    typeLabel: fieldTypeLabel(fieldTypeName(0)),
  };
  while (cursor < end) {
    const tag = readTag(bytes, cursor);
    if (!tag) break;
    const content = cursor + 4;
    if (tag.tagId === EXERCISE_MODES_DISP_FIELD_SETTING) {
      const idx = bytes[content] | (bytes[content + 1] << 8);
      const typ = bytes[content + 2] | (bytes[content + 3] << 8);
      field.index = idx;
      field.indexName = fieldTypeName(idx);
      field.type = typ;
      field.typeName = fieldTypeName(typ);
      field.typeLabel = fieldTypeLabel(field.typeName);
    }
    cursor = content + tag.length;
  }
  return field;
}

export interface Display {
  template: number;
  templateName: string;
  // Real, 2026-08-09 - human-readable label (fieldTypeLabel(templateName)), same real fix
  // desktop's SportModesPage.qml already has.
  templateLabel: string;
  fields: DisplayField[];
  // Filled in by numberDisplays() after all of a mode's displays are collected - a single
  // display can't know its own screenNumber/isBuiltIn in isolation (the classification looks
  // at the *tail* of the whole list).
  screenNumber: number | null;
  isBuiltIn: boolean;
}

function decodeDisplay(bytes: Uint8Array, offset: number, length: number): Display {
  const end = offset + length;
  let cursor = offset;
  const display: Display = {
    template: 0, templateName: fieldTypeName(0), templateLabel: fieldTypeLabel(fieldTypeName(0)),
    fields: [], screenNumber: null, isBuiltIn: false,
  };
  while (cursor < end) {
    const tag = readTag(bytes, cursor);
    if (!tag) break;
    const content = cursor + 4;
    if (tag.tagId === EXERCISE_MODES_DISP_SETTING) {
      const tpl = bytes[content] | (bytes[content + 1] << 8);
      display.template = tpl;
      display.templateName = fieldTypeName(tpl);
      display.templateLabel = fieldTypeLabel(display.templateName);
    } else if (tag.tagId === EXERCISE_MODES_DISP_FIELD) {
      display.fields.push(decodeDispField(bytes, content, tag.length));
    }
    cursor = content + tag.length;
  }
  return display;
}

// Real, hardware-confirmed fixed "system tail" every real sport mode's own Displays array
// ends with - direct TS port of tools/custom_modes.py's own _GPS_SYSTEM_TAIL/
// _NON_GPS_SYSTEM_TAIL/system_tail_length() (see that module's own comment for the full
// derivation: 6/6 tested GPS-capable activities get this exact 7-entry tail, Pool swimming -
// the only non-GPS activity tested - gets this 3-entry one; the very last entry is always
// 0x0127 across all 7 modes tested). Android's own CustomModesReader.ts never had this fix
// applied (it's an independent decoder from the Python one desktop uses) until now - real,
// 2026-08-09 ("replicate the desktop version feature wise").
const GPS_SYSTEM_TAIL = [
  'PID_RUNNER_GPS_TEMPLATE_11_COMPASS_NAVIGATE',
  'PID_RUNNER_GPS_TEMPLATE_11_MILS_COMPASS_NAVIGATE',
  'PID_RUNNER_GPS_TEMPLATE_22_NAVIGATION',
  'PID_RUNNER_GPS_TEMPLATE_1G_GRAPH',
  'PID_RUNNER_GPS_TEMPLATE_50_MAP_DRAW',
  'PID_RUNNER_GPS_TEMPLATE_4',
  '0x0127',
];
const NON_GPS_SYSTEM_TAIL = ['PID_RUNNER_GPS_TEMPLATE_4', '0x0124', '0x0127'];

function systemTailLength(templateNames: string[]): number {
  const gpsLen = GPS_SYSTEM_TAIL.length;
  if (templateNames.length >= gpsLen
      && templateNames.slice(-gpsLen).every((n, i) => n === GPS_SYSTEM_TAIL[i])) {
    return gpsLen;
  }
  const nonGpsLen = NON_GPS_SYSTEM_TAIL.length;
  if (templateNames.length >= nonGpsLen
      && templateNames.slice(-nonGpsLen).every((n, i) => n === NON_GPS_SYSTEM_TAIL[i])) {
    return nonGpsLen;
  }
  return 0;
}

/** Mutates each display in place with its real screenNumber (1-based, null for a built-in
 * system-tail screen) and isBuiltIn flag - same real invariant as custom_modes.py's own
 * _displays_to_json(): index (this array's own position) never changes, only these two new
 * fields get added. */
function numberDisplays(displays: Display[]): void {
  const tailLen = systemTailLength(displays.map(d => d.templateName));
  const realCount = displays.length - tailLen;
  displays.forEach((d, i) => {
    d.isBuiltIn = i >= realCount;
    d.screenNumber = d.isBuiltIn ? null : i + 1;
  });
}

export interface ExerciseMode {
  settings: ExerciseModeSettings;
  displays: Display[];
}

function decodeExerciseMode(bytes: Uint8Array, offset: number, length: number): ExerciseMode {
  const end = offset + length;
  let cursor = offset;
  const mode: ExerciseMode = {
    settings: { name: '', activityId: 0, useHw: 0, altiBaroMode: 0, recordingInterval: 0,
      autolap: 0, hrHigh: 0, hrLow: 0, hrLimitsUse: 0 },
    displays: [],
  };
  while (cursor < end) {
    const tag = readTag(bytes, cursor);
    if (!tag) break;
    const content = cursor + 4;
    if (tag.tagId === EXERCISE_MODES_SETTING_NAME_LEN64) {
      mode.settings = decodeSettings(bytes, content);
    } else if (tag.tagId === EXERCISE_MODES_DISPLAYS) {
      let subCursor = content;
      const subEnd = content + tag.length;
      while (subCursor < subEnd) {
        const subTag = readTag(bytes, subCursor);
        if (!subTag) break;
        const subContent = subCursor + 4;
        if (subTag.tagId === EXERCISE_MODES_DISPLAY) {
          mode.displays.push(decodeDisplay(bytes, subContent, subTag.length));
        }
        subCursor = subContent + subTag.length;
      }
    }
    cursor = content + tag.length;
  }
  numberDisplays(mode.displays);
  return mode;
}

export interface SportModeSlot {
  name: string;
  activityId: number;
  legs: number[];
}

function decodeSportModeSlot(bytes: Uint8Array, offset: number, length: number): SportModeSlot {
  const end = offset + length;
  let cursor = offset;
  const slot: SportModeSlot = { name: '', activityId: 0, legs: [] };
  while (cursor < end) {
    const tag = readTag(bytes, cursor);
    if (!tag) break;
    const content = cursor + 4;
    if (tag.tagId === SPORT_MODE_SETTING_NAME_LEN64) {
      slot.name = decodeNameField(bytes, content, tag.length);
    } else if (tag.tagId === SPORT_MODE_ACTIVITY_ID) {
      slot.activityId = bytes[content] | (bytes[content + 1] << 8);
    } else if (tag.tagId === SPORT_MODE_EXERCISE) {
      slot.legs.push(bytes[content] | (bytes[content + 1] << 8));
    }
    cursor = content + tag.length;
  }
  return slot;
}

export interface DecodedCustomModes {
  exerciseModes: ExerciseMode[];
  sportModes: SportModeSlot[];
}

/** Decodes a raw CustomModes flash dump (12288 bytes, from readCustomModesRaw()). Mirrors
 * custom_modes.py's own decode() exactly - same tag walk, same field names. */
export function decode(bytes: Uint8Array): DecodedCustomModes {
  const root = readTag(bytes, 0);
  if (!root || root.tagId !== DEVICE_CUSTOM) {
    throw new Error(`expected DEVICE_CUSTOM at offset 0, got ${root ? `0x${root.tagId.toString(16)}` : 'nothing'}`);
  }
  let cursor = 4;
  const end = 4 + root.length;
  const result: DecodedCustomModes = { exerciseModes: [], sportModes: [] };

  while (cursor < end) {
    const tag = readTag(bytes, cursor);
    if (!tag) break;
    const content = cursor + 4;

    if (tag.tagId === EXERCISE_MODES) {
      let subCursor = content;
      const subEnd = content + tag.length;
      while (subCursor < subEnd) {
        const subTag = readTag(bytes, subCursor);
        if (!subTag) break;
        const subContent = subCursor + 4;
        if (subTag.tagId === EXERCISE_MODES_MODE) {
          result.exerciseModes.push(decodeExerciseMode(bytes, subContent, subTag.length));
        }
        subCursor = subContent + subTag.length;
      }
    } else if (tag.tagId === SPORT_MODES) {
      let subCursor = content;
      const subEnd = content + tag.length;
      while (subCursor < subEnd) {
        const subTag = readTag(bytes, subCursor);
        if (!subTag) break;
        const subContent = subCursor + 4;
        if (subTag.tagId === SPORT_MODE) {
          const slot = decodeSportModeSlot(bytes, subContent, subTag.length);
          if (slot.name) result.sportModes.push(slot);
        }
        subCursor = subContent + subTag.length;
      }
    }

    cursor = content + tag.length;
  }
  return result;
}
