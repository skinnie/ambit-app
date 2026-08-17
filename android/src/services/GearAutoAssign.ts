import { getDefaultGearFor, getGearById, recordActivityGear } from '../database/gearDb';
import { setActivityGear } from './ApiIntervalsIcuGear';

// Auto-assign (decision 2): the default bike/shoes for a sport type, used two ways:
//  • pushGearToIntervals — tag an uploaded intervals.icu activity with the gear (best-effort).
//  • attributeMoveToGear — record the move in the LOCAL usage ledger with its distance, so the
//    app tallies gear mileage itself (GearTotals) and can eventually drop intervals.icu.
// Both are best-effort and non-fatal — a failure must never break the sync/upload the user did.

/** Push the default gear for this sport onto an already-uploaded intervals.icu activity.
 * Returns the gear name (for a toast) or null. Idempotent: re-PUTting the same gear is harmless. */
export async function pushGearToIntervals(
  intervalsActivityId: string, activityType: string,
): Promise<string | null> {
  try {
    if (!intervalsActivityId || !activityType) return null;
    const gear = await defaultGear(activityType);
    if (!gear?.remoteId) return null;
    await setActivityGear(intervalsActivityId, gear.remoteId);
    return gear.name;
  } catch (e: any) {
    console.log('[gear] push to intervals skipped:', e?.message ?? e);
    return null;
  }
}

/** Attribute a synced watch move to its default gear in the local ledger (idempotent per id). */
export async function attributeMoveToGear(
  activityId: string, activityType: string, distanceM: number, timeS: number, date = '',
): Promise<void> {
  try {
    if (!activityId || !activityType) return;
    const gear = await defaultGear(activityType);
    if (!gear) return;
    await recordActivityGear(activityId, gear.id, distanceM || 0, timeS || 0, date);
  } catch (e: any) {
    console.log('[gear] local attribution skipped:', e?.message ?? e);
  }
}

async function defaultGear(activityType: string) {
  const gearLocalId = await getDefaultGearFor(activityType);
  if (!gearLocalId) return null;
  const gear = await getGearById(gearLocalId);
  if (!gear || gear.deleted) return null;
  return gear;
}
