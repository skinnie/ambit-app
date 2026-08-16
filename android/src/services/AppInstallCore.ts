import { DecodedRegion } from './SportModeCodec';

// Pure (native-free) core of the App-Zone install so it can be unit-proven without pulling in
// the native module. AppInstall.ts (orchestration) re-exports these and adds the read/write.

// The three rule-engine slots an app can render on (FT_RULE_ENGINE_0/1/2). The Nth app placed
// on a mode uses APP_SLOT_TYPES[N] - the app's 0-based position in that mode's RULES list.
export const APP_SLOT_TYPES = [51, 52, 53];
const SPORT_MODE_APP_LIMIT = 5; // apps assigned per mode (RULES); only 3 can be *placed* on fields

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));

/** Wire an app into a CustomModes mode exactly as SuuntoLink does (Finding 44), on the DECODED
 * region so the proven SportModeCodec re-encodes it byte-exact - no byte surgery. Mirrors
 * workout_install.install_app_into_mode: add the RULE {ruleIdx, UseRule=1, LogRule=0}, stamp
 * AppMeta {now, now+2}, and APPEND the app's engine slot (51/52/53 = the mode's Nth app) as a
 * shortcut on the chosen display field. `ruleIdx` is the app's 0-based index in the Apps region. */
export function installShortcutIntoMode(
  decoded: DecodedRegion, modeIndex: number, displayIndex: number, fieldIndex: number,
  ruleIdx: number, now: number,
): DecodedRegion {
  const out = clone(decoded);
  const mode = out.exercise_modes[modeIndex];
  if (!mode) throw new Error(`mode ${modeIndex} does not exist`);
  const nExisting = mode.Rules.length;
  if (nExisting >= SPORT_MODE_APP_LIMIT) throw new Error(`this mode already has ${nExisting} Suunto Apps (limit ${SPORT_MODE_APP_LIMIT})`);
  if (nExisting >= APP_SLOT_TYPES.length) throw new Error(`this mode already has ${nExisting} apps placed - only ${APP_SLOT_TYPES.length} render slots exist`);

  mode.Rules.push({ RuleIdx: ruleIdx, UseRule: true, LogRule: false });
  mode.AppMeta = { Timestamp1: now, Timestamp2: now + 2 };

  const display = mode.Displays[displayIndex];
  if (!display) throw new Error(`display ${displayIndex} does not exist on this mode`);
  const field = display.Fields[fieldIndex];
  if (!field) throw new Error(`field ${fieldIndex} does not exist on display ${displayIndex}`);
  field.Shortcuts.push(APP_SLOT_TYPES[nExisting]);
  return out;
}
