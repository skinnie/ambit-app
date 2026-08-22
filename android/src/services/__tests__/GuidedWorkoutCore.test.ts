import { findModeIndex, ensureGuidanceDisplay, GUIDANCE_TEMPLATE } from '../GuidedWorkoutCore';
import { DecodedRegion } from '../SportModeCodec';

function fixture(): DecodedRegion {
  return {
    formatType: 2,
    exercise_modes: [
      { Settings: { Name: 'Running' } as any, Displays: [{ Template: 260, Type: 10, Fields: [] }], Rules: [], AppMeta: null },
      { Settings: { Name: 'Cycling' } as any, Displays: [], Rules: [], AppMeta: null },
    ],
    sport_modes: [],
  };
}

describe('GuidedWorkoutCore', () => {
  test('findModeIndex is case-insensitive and matches by name', () => {
    const decoded = fixture();
    expect(findModeIndex(decoded, 'running')).toBe(0);
    expect(findModeIndex(decoded, 'Cycling')).toBe(1);
  });

  test('findModeIndex throws with the available names when nothing matches', () => {
    const decoded = fixture();
    expect(() => findModeIndex(decoded, 'Skiing')).toThrow(/Running, Cycling/);
  });

  test('ensureGuidanceDisplay adds the display and does not mutate the input', () => {
    const decoded = fixture();
    const { decoded: out, added } = ensureGuidanceDisplay(decoded, 0);
    expect(added).toBe(true);
    expect(out.exercise_modes[0].Displays.some((d) => d.Template === GUIDANCE_TEMPLATE)).toBe(true);
    expect(decoded.exercise_modes[0].Displays.some((d) => d.Template === GUIDANCE_TEMPLATE)).toBe(false);
  });

  test('ensureGuidanceDisplay is idempotent - a second call on the result adds nothing', () => {
    const decoded = fixture();
    const first = ensureGuidanceDisplay(decoded, 0);
    const second = ensureGuidanceDisplay(first.decoded, 0);
    expect(second.added).toBe(false);
    expect(second.decoded.exercise_modes[0].Displays.filter((d) => d.Template === GUIDANCE_TEMPLATE).length).toBe(1);
  });

  test('the guidance display carries no rule wiring (Fields empty) - stays dormant until picked', () => {
    const { decoded } = ensureGuidanceDisplay(fixture(), 1);
    const gd = decoded.exercise_modes[1].Displays.find((d) => d.Template === GUIDANCE_TEMPLATE)!;
    expect(gd.Fields).toEqual([]);
    expect(decoded.exercise_modes[1].Rules).toEqual([]);
  });
});
