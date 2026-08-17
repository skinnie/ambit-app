// Pure, dependency-free gear-distance tally — the independence primitive (André 2026-08-18:
// "the aim is to ditch intervals in the future"). Displayed distance for a gear =
//   imported baseline (intervals.icu's authoritative total at import) + everything the app has
//   attributed to that gear SINCE that import.
// The "since import" guard (assignedAt > baselineAt) is what stops double-counting: anything
// intervals already had in its number is not re-added from the local ledger.

export interface GearBaseline {
  id: string;
  distanceM: number;   // gear.distanceM at last import (0 for a local-only gear)
  timeS: number;
  baselineAt: number;  // gear.lastSyncedAt (0 = never imported)
}

export interface LedgerEntry {
  gearId: string;
  distanceM: number;
  timeS: number;
  assignedAt: number;
}

export interface GearTotal {
  distanceM: number;   // baseline + local additions
  timeS: number;
  addedM: number;      // local additions only (activities the app tallied since import)
  addedCount: number;
}

// ── Local reminder due-ness ───────────────────────────────────────────────────
// Compute a reminder's "percent used" from its reset-baseline and the gear's locally-tracked
// total, so due-ness no longer needs intervals' percent_used. A reminder may combine units
// (distance/time/days/activities); we take whichever is furthest along, matching intervals.
// Distance/time are exact (gear total includes the imported baseline); activities-since-reset is
// approximated by the local added count (fine for the common distance/time reminders).

export interface ReminderCalc {
  distanceM: number; timeS: number; days: number; activities: number; // intervals (0 = unused)
  startingDistanceM: number; startingTimeS: number; startingActivities: number;
  lastReset: number | null;
}

export interface GearNow {
  distanceM: number;   // gear total now (baseline + local additions)
  timeS: number;
  activitiesSinceReset: number; // local added count
}

/** 0..100+ (>=100 => due). Snooze is handled by the caller. */
export function reminderPercentUsed(r: ReminderCalc, gear: GearNow, now: number): number {
  const pcts: number[] = [];
  if (r.distanceM > 0) pcts.push(Math.max(0, gear.distanceM - r.startingDistanceM) / r.distanceM * 100);
  if (r.timeS > 0) pcts.push(Math.max(0, gear.timeS - r.startingTimeS) / r.timeS * 100);
  if (r.days > 0 && r.lastReset != null) pcts.push((now - r.lastReset) / 86_400_000 / r.days * 100);
  if (r.activities > 0) pcts.push(gear.activitiesSinceReset / r.activities * 100);
  return pcts.length ? Math.max(...pcts) : 0;
}

// ── Maintenance alerts (for the Home summary) ─────────────────────────────────
export interface GearAlertInput {
  gearId: string;
  gearName: string;
  now: GearNow;
  reminders: (ReminderCalc & { name: string; snoozedUntil?: number | null })[];
}
export interface GearAlert { gearId: string; gearName: string; reminderName: string; percent: number }

/** Collect reminders that are due (>=100%) or soon (>=90%), snoozed ones excluded, most-worn
 * first. Drives the Home "maintenance due" summary on both platforms. */
export function collectGearAlerts(
  inputs: GearAlertInput[], now: number,
): { due: GearAlert[]; soon: GearAlert[] } {
  const due: GearAlert[] = [];
  const soon: GearAlert[] = [];
  for (const g of inputs) {
    for (const r of g.reminders) {
      if (r.snoozedUntil != null && now < r.snoozedUntil) continue;
      const pct = reminderPercentUsed(r, g.now, now);
      const alert: GearAlert = { gearId: g.gearId, gearName: g.gearName, reminderName: r.name, percent: Math.round(pct) };
      if (pct >= 100) due.push(alert);
      else if (pct >= 90) soon.push(alert);
    }
  }
  due.sort((a, b) => b.percent - a.percent);
  soon.sort((a, b) => b.percent - a.percent);
  return { due, soon };
}

export function computeGearTotals(
  gears: GearBaseline[], ledger: LedgerEntry[],
): Map<string, GearTotal> {
  const out = new Map<string, GearTotal>();
  for (const g of gears) {
    out.set(g.id, { distanceM: g.distanceM, timeS: g.timeS, addedM: 0, addedCount: 0 });
  }
  for (const e of ledger) {
    const g = gears.find(x => x.id === e.gearId);
    if (!g) continue;                 // ledger entry for gear we don't hold — ignore
    if (e.assignedAt <= g.baselineAt) continue; // already in the imported baseline
    const cur = out.get(g.id)!;
    cur.distanceM += e.distanceM;
    cur.timeS += e.timeS;
    cur.addedM += e.distanceM;
    cur.addedCount += 1;
  }
  return out;
}
