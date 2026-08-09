import { DecodedSetting, SettingChoice } from './AmbitSettingsReader';

// Ambit 1 / Ambit 2 family (USB-only) personal-settings decode.
//
// These 2012-era watches don't use the Ambit3/Kailash SBEM sml.DeviceSettings (0x1100) at
// all — they answer the legacy personal-settings command, which libambit parses into a fixed
// ambit_personal_settings_t struct (bundled device_driver_ambit.c / personal.c, from
// openambit — assets/openambit-master.zip). nativeAmbitReadPersonalSettings() returns the
// user-facing fields as JSON of field -> raw int; this maps each to a labelled DecodedSetting
// so the exact same settings UI the Ambit3/Kailash path uses renders them unchanged.
//
// Option labels mirror two references in this repo's assets:
//   - openambit's ambit_personal_settings_t (src/libambit/libambit.h, personal.c)
//   - the Movescount Emulation Project's own schema-settings
//     (assets/Movescount_Emu/ServerFiles/data/schema-settings) — its enum option meanings
//     (Backlight Mode 0-4, AltiBaro 0-2, etc.), which are shared across the Ambit family.
//
// READ-ONLY: libambit implements no personal-settings write (only the unused 0x0b01 command
// id exists), so the UI shows these values but offers no editing for Ambit 1/2 — the same
// "prove it, don't brick it" caution the Ambit3 write path already follows.

const LANGUAGES: SettingChoice[] = [
  { value: 0, label: 'Dansk' }, { value: 1, label: 'Deutsch' }, { value: 2, label: 'English' },
  { value: 3, label: 'Espanol' }, { value: 4, label: 'Francais' }, { value: 5, label: 'Italiano' },
  { value: 6, label: 'Nederlands' }, { value: 7, label: 'Norsk' }, { value: 8, label: 'Portugues' },
  { value: 9, label: 'Suomi' }, { value: 10, label: 'Svenska' }, { value: 11, label: 'Chinese' },
  { value: 12, label: 'Japanese' }, { value: 13, label: 'Korean' }, { value: 14, label: 'Cestina' },
  { value: 15, label: 'Polski' }, { value: 16, label: 'Russian' },
];

interface PersonalField {
  key: string;
  kind: 'bool' | 'enum' | 'number';
  choices?: SettingChoice[];
}

const AMBIT12_PERSONAL_FIELDS: PersonalField[] = [
  { key: 'date_format', kind: 'enum', choices: [{ value: 0, label: 'DDMM' }, { value: 1, label: 'MMDD' }] },
  { key: 'tones', kind: 'enum', choices: [{ value: 0, label: 'Buttons off' }, { value: 1, label: 'All on' }, { value: 2, label: 'All off' }] },
  { key: 'gps_position_format', kind: 'enum', choices: [
      { value: 0, label: 'WGS84 d' }, { value: 1, label: 'WGS84 dm' }, { value: 2, label: 'WGS84 dms' },
      { value: 3, label: 'UTM' }, { value: 4, label: 'MGRS' }, { value: 5, label: 'British (BNG)' },
      { value: 6, label: 'Finnish (ETRS-TM35FIN)' }, { value: 7, label: 'Finnish (KKJ)' },
      { value: 8, label: 'Irish (IG)' }, { value: 9, label: 'Swedish (RT90)' }, { value: 10, label: 'Swiss (CH1903)' },
      { value: 11, label: 'UTM NAD27 Alaska' }, { value: 12, label: 'UTM NAD27 Conus' },
      { value: 13, label: 'UTM NAD83' }, { value: 14, label: 'NZTM2000' },
    ] },
  { key: 'button_lock_sport_mode', kind: 'enum', choices: [{ value: 0, label: 'All buttons' }, { value: 1, label: 'Actions only' }] },
  { key: 'button_lock_time_mode', kind: 'enum', choices: [{ value: 0, label: 'All buttons' }, { value: 1, label: 'Actions only' }] },
  { key: 'units_mode', kind: 'enum', choices: [{ value: 0, label: 'Metric' }, { value: 1, label: 'Imperial' }, { value: 2, label: 'Advanced' }] },
  { key: 'language', kind: 'enum', choices: LANGUAGES },
  { key: 'time_format', kind: 'enum', choices: [{ value: 0, label: '24h' }, { value: 1, label: '12h' }] },
  { key: 'gps_time_keeping', kind: 'enum', choices: [{ value: 0, label: 'On' }, { value: 1, label: 'Off' }] },
  { key: 'alti_baro_mode', kind: 'enum', choices: [{ value: 0, label: 'Altimeter' }, { value: 1, label: 'Barometer' }, { value: 2, label: 'Automatic' }] },
  { key: 'backlight_mode', kind: 'enum', choices: [
      { value: 0, label: 'Normal' }, { value: 1, label: 'Off' }, { value: 2, label: 'Night' },
      { value: 3, label: 'Toggle' }, { value: 4, label: 'Automatic' },
    ] },
  { key: 'backlight_brightness', kind: 'number' },
  { key: 'display_dark', kind: 'bool' },
  { key: 'storm_alarm', kind: 'bool' },
];

/** Decodes the JSON from readPersonalSettings() (native/AmbitUsbModule.ts) into the same
 * DecodedSetting[] shape the Ambit3/Kailash reader produces, so the settings UI renders it
 * unchanged. Fields the watch didn't report are skipped. Returns [] on malformed input. */
export function decodePersonalSettings(json: string): DecodedSetting[] {
  let obj: Record<string, unknown>;
  try { obj = JSON.parse(json); } catch { return []; }
  const out: DecodedSetting[] = [];
  for (const f of AMBIT12_PERSONAL_FIELDS) {
    const v = obj[f.key];
    if (typeof v !== 'number') continue;
    out.push({ key: f.key, path: f.key, kind: f.kind, value: v, choices: f.choices });
  }
  return out;
}
