import {
  computeGearTotals, reminderPercentUsed, collectGearAlerts,
  GearBaseline, LedgerEntry, ReminderCalc,
} from '../GearTotals';

const baseline = (over: Partial<GearBaseline>): GearBaseline =>
  ({ id: 'g1', distanceM: 1_000_000, timeS: 0, baselineAt: 1000, ...over });
const entry = (over: Partial<LedgerEntry>): LedgerEntry =>
  ({ gearId: 'g1', distanceM: 20_000, timeS: 3600, assignedAt: 2000, ...over });

describe('computeGearTotals', () => {
  test('no ledger => just the imported baseline', () => {
    const t = computeGearTotals([baseline({})], []);
    expect(t.get('g1')).toEqual({ distanceM: 1_000_000, timeS: 0, addedM: 0, addedCount: 0 });
  });

  test('activity after import is added on top of the baseline', () => {
    const t = computeGearTotals([baseline({})], [entry({ assignedAt: 2000 })]);
    expect(t.get('g1')!.distanceM).toBe(1_020_000);
    expect(t.get('g1')!.addedM).toBe(20_000);
    expect(t.get('g1')!.addedCount).toBe(1);
  });

  test('activity at/ before the import baseline is NOT double-counted', () => {
    const t = computeGearTotals([baseline({ baselineAt: 1000 })], [
      entry({ assignedAt: 500 }),  // before import — already in intervals total
      entry({ assignedAt: 1000 }), // exactly at import — treated as already counted
    ]);
    expect(t.get('g1')!.distanceM).toBe(1_000_000);
    expect(t.get('g1')!.addedCount).toBe(0);
  });

  test('local-only gear (never imported) totals purely from the ledger', () => {
    const t = computeGearTotals([baseline({ id: 'local1', distanceM: 0, baselineAt: 0 })], [
      entry({ gearId: 'local1', distanceM: 5_000, assignedAt: 1 }),
      entry({ gearId: 'local1', distanceM: 7_000, assignedAt: 2 }),
    ]);
    expect(t.get('local1')!.distanceM).toBe(12_000);
    expect(t.get('local1')!.addedCount).toBe(2);
  });

  test('ledger entry for unknown gear is ignored', () => {
    const t = computeGearTotals([baseline({})], [entry({ gearId: 'ghost' })]);
    expect(t.get('g1')!.addedCount).toBe(0);
    expect(t.has('ghost')).toBe(false);
  });
});

const rem = (over: Partial<ReminderCalc>): ReminderCalc => ({
  distanceM: 0, timeS: 0, days: 0, activities: 0,
  startingDistanceM: 0, startingTimeS: 0, startingActivities: 0, lastReset: null, ...over,
});
const NOW = 1_000_000_000_000;

describe('reminderPercentUsed (local due-ness)', () => {
  test('distance: (gear total − starting) / interval', () => {
    // 500 km interval, reset at 1000 km, gear now at 1400 km => 400/500 = 80%
    const p = reminderPercentUsed(
      rem({ distanceM: 500_000, startingDistanceM: 1_000_000 }),
      { distanceM: 1_400_000, timeS: 0, activitiesSinceReset: 0 }, NOW);
    expect(p).toBeCloseTo(80);
  });

  test('distance: at/over interval reads >=100 (due)', () => {
    const p = reminderPercentUsed(
      rem({ distanceM: 500_000, startingDistanceM: 1_000_000 }),
      { distanceM: 1_500_000, timeS: 0, activitiesSinceReset: 0 }, NOW);
    expect(p).toBeGreaterThanOrEqual(100);
  });

  test('days: elapsed since last reset / interval', () => {
    const p = reminderPercentUsed(
      rem({ days: 100, lastReset: NOW - 50 * 86_400_000 }),
      { distanceM: 0, timeS: 0, activitiesSinceReset: 0 }, NOW);
    expect(p).toBeCloseTo(50);
  });

  test('combined units => the furthest-along one wins', () => {
    const p = reminderPercentUsed(
      rem({ distanceM: 1_000_000, startingDistanceM: 0, days: 100, lastReset: NOW - 90 * 86_400_000 }),
      { distanceM: 300_000, timeS: 0, activitiesSinceReset: 0 }, NOW); // 30% distance vs 90% days
    expect(p).toBeCloseTo(90);
  });

  test('no interval set => 0', () => {
    expect(reminderPercentUsed(rem({}), { distanceM: 9e9, timeS: 0, activitiesSinceReset: 0 }, NOW)).toBe(0);
  });
});

describe('collectGearAlerts', () => {
  const input = (gearName: string, distanceM: number, reminders: any[]) => ({
    gearId: gearName, gearName, now: { distanceM, timeS: 0, activitiesSinceReset: 0 }, reminders,
  });

  test('splits due (>=100%) from soon (>=90%), skips healthy, sorts by wear', () => {
    const { due, soon } = collectGearAlerts([
      input('Bike A', 1_100_000, [{ ...rem({ distanceM: 1_000_000 }), name: 'chain' }]),   // 110% due
      input('Bike B', 950_000, [{ ...rem({ distanceM: 1_000_000 }), name: 'tyres' }]),      // 95% soon
      input('Bike C', 100_000, [{ ...rem({ distanceM: 1_000_000 }), name: 'cables' }]),     // 10% quiet
      input('Bike D', 2_000_000, [{ ...rem({ distanceM: 1_000_000 }), name: 'cassette' }]), // 200% due
    ], NOW);
    expect(due.map(d => d.reminderName)).toEqual(['cassette', 'chain']); // most-worn first
    expect(soon.map(s => s.reminderName)).toEqual(['tyres']);
  });

  test('snoozed reminder is excluded', () => {
    const { due } = collectGearAlerts([
      input('Bike', 2_000_000, [{ ...rem({ distanceM: 1_000_000 }), name: 'chain', snoozedUntil: NOW + 86_400_000 }]),
    ], NOW);
    expect(due).toHaveLength(0);
  });
});
