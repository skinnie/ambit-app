// Proof that the TS App-Zone source generator matches the Python tools/workout.py
// generate_source / build_compile_request exactly, for a real 5x3min interval workout. This
// makes the generated compiler input identical to the proven Python tool's; the compiler
// itself (third-party) and the on-watch result are the unproven parts, by nature.

import { generateSource, buildCompileRequest } from '../WorkoutSource';
import fx from './workoutsource_fixture.json';

describe('WorkoutSource', () => {
  test('generateSource matches the Python generator (source + own vars)', () => {
    const [source, ownVars] = generateSource(fx.workout as any);
    expect(source).toBe(fx.source);
    expect(ownVars).toEqual(fx.ownVars);
  });

  test('buildCompileRequest matches the Python compile request byte-for-byte', () => {
    const [source, ownVars] = generateSource(fx.workout as any);
    const req = buildCompileRequest(source, ownVars, fx.workout.name);
    expect(req).toBe(fx.request);
  });
});
