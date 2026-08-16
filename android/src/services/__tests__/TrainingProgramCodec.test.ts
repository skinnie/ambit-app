// Byte-exact proof that the TS TrainingProgram builder matches the Python
// tools/training_program.py builder. NOTE: this proves only that the two BUILDERS agree - the
// format itself has no real capture and its effect on the watch is unconfirmed (see
// TrainingProgramCodec.ts header). It guards against a TS-vs-Python divergence, nothing more.

import { buildTrainingItem, buildTrainingProgram } from '../TrainingProgramCodec';
import fx from './trainingprogram_fixture.json';

declare const Buffer: { from(data: string, encoding: string): Uint8Array };
const b64 = (s: string) => new Uint8Array(Buffer.from(s, 'base64'));

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

describe('TrainingProgramCodec', () => {
  test('each 40-byte item matches the Python builder', () => {
    for (const it of fx.items) {
      const got = buildTrainingItem({
        activityId: it.activityId, durationMinutes: it.durationMinutes, intensity: it.intensity,
        name: it.name, dayOffset: it.dayOffset, distance: (it as any).distance,
        completed: (it as any).completed, moveId: (it as any).moveId,
      });
      expect(got.length).toBe(40);
      expect(bytesEqual(got, b64(it.bytes))).toBe(true);
    }
  });

  test('the full program blob (header + items) matches the Python builder', () => {
    const items = fx.items.map(it => buildTrainingItem({
      activityId: it.activityId, durationMinutes: it.durationMinutes, intensity: it.intensity,
      name: it.name, dayOffset: it.dayOffset, distance: (it as any).distance,
      completed: (it as any).completed, moveId: (it as any).moveId,
    }));
    const got = buildTrainingProgram(items, 0);
    expect(bytesEqual(got, b64(fx.program))).toBe(true);
  });
});
