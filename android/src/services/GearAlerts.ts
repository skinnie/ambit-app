import { getAllGear, getReminders, getGearLedger } from '../database/gearDb';
import { computeGearTotals, collectGearAlerts, GearAlert, GearAlertInput } from './GearTotals';

// Assemble the maintenance-due summary for Home from the local store: gear + reminders + the
// locally-tracked totals, run through the pure collectGearAlerts. All local — no network.
export async function getGearAlerts(): Promise<{ due: GearAlert[]; soon: GearAlert[] }> {
  const gears = await getAllGear();
  if (gears.length === 0) return { due: [], soon: [] };

  const ledger = await getGearLedger();
  const totals = computeGearTotals(
    gears.map(g => ({ id: g.id, distanceM: g.distanceM, timeS: g.timeS, baselineAt: g.lastSyncedAt })),
    ledger,
  );

  const inputs: GearAlertInput[] = [];
  for (const g of gears) {
    const reminders = await getReminders(g.id);
    if (reminders.length === 0) continue;
    const t = totals.get(g.id);
    inputs.push({
      gearId: g.id,
      gearName: g.name,
      now: { distanceM: t?.distanceM ?? g.distanceM, timeS: t?.timeS ?? g.timeS, activitiesSinceReset: t?.addedCount ?? 0 },
      reminders: reminders.map(r => ({
        distanceM: r.distanceM, timeS: r.timeS, days: r.days, activities: r.activities,
        startingDistanceM: r.startingDistanceM, startingTimeS: r.startingTimeS,
        startingActivities: r.startingActivities, lastReset: r.lastReset,
        name: r.name, snoozedUntil: r.snoozedUntil,
      })),
    });
  }
  return collectGearAlerts(inputs, Date.now());
}
