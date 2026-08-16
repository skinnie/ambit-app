// Byte-exact proof for the App-Zone CustomModes shortcut install, against the proven Python
// tools/workout_install.install_app_into_mode. The fixture is a real CustomModes region (the
// sport-mode capture's image 0, padded to the full 12288) with an app wired onto
// (mode 0, display 0, field 0) by the Python tool at a fixed timestamp. Proves that doing the
// same mutation on the decoded region and re-encoding with SportModeCodec reproduces
// SuuntoLink's own bytes exactly - no byte surgery, and no watch/app-build needed.

import { decode, encodeBody } from '../SportModeCodec';
import { installShortcutIntoMode, APP_SLOT_TYPES } from '../AppInstallCore';
import fx from './appinstall_fixture.json';

declare const Buffer: { from(data: string, encoding: string): Uint8Array };
const b64 = (s: string) => new Uint8Array(Buffer.from(s, 'base64'));

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

describe('AppInstall (CustomModes shortcut)', () => {
  test('installShortcutIntoMode reproduces SuuntoLink byte-exact (vs workout_install)', () => {
    const before = decode(b64(fx.before));
    const after = installShortcutIntoMode(before, fx.modeIndex, fx.displayIndex, fx.fieldIndex, fx.ruleIdx, fx.now);
    const got = encodeBody(after);
    expect(bytesEqual(got, b64(fx.afterUsed))).toBe(true);
  });

  test('the first app on a mode uses render slot 51 (FT_RULE_ENGINE_0)', () => {
    const before = decode(b64(fx.before));
    const after = installShortcutIntoMode(before, fx.modeIndex, fx.displayIndex, fx.fieldIndex, fx.ruleIdx, fx.now);
    const field = after.exercise_modes[fx.modeIndex].Displays[fx.displayIndex].Fields[fx.fieldIndex];
    expect(field.Shortcuts[field.Shortcuts.length - 1]).toBe(APP_SLOT_TYPES[0]);
    // RULE recorded with the app's Apps-region index, enabled, not logged.
    const rule = after.exercise_modes[fx.modeIndex].Rules.slice(-1)[0];
    expect(rule).toEqual({ RuleIdx: fx.ruleIdx, UseRule: true, LogRule: false });
    // AppMeta stamped {now, now+2}.
    expect(after.exercise_modes[fx.modeIndex].AppMeta).toEqual({ Timestamp1: fx.now, Timestamp2: fx.now + 2 });
  });

  test('does not disturb any other mode (only the target changed)', () => {
    const before = decode(b64(fx.before));
    const after = installShortcutIntoMode(before, fx.modeIndex, fx.displayIndex, fx.fieldIndex, fx.ruleIdx, fx.now);
    for (let i = 0; i < before.exercise_modes.length; i++) {
      if (i === fx.modeIndex) continue;
      expect(JSON.stringify(after.exercise_modes[i])).toBe(JSON.stringify(before.exercise_modes[i]));
    }
    expect(JSON.stringify(after.sport_modes)).toBe(JSON.stringify(before.sport_modes));
  });
});
