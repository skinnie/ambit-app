// Pure intervals.icu gear model + normalisers — NO react-native / network imports, so it is
// unit-testable and shared by the network client (ApiIntervalsIcuGear), the reconcile engine
// (GearDiff) and the mirror (GearMirrorService). Schema confirmed against a live GET /gear
// (2026-08-17); see docs/reference/intervals-gear-schema.md.

export interface RemoteGear {
  id: string;
  name: string;
  type: string;            // "Bike" | "Shoes" | "Chain" | "Tyre" | ...
  component: boolean;
  componentIds: string[];
  distanceM: number;
  timeS: number;
  retired: boolean;
  reminders: RemoteReminder[];
}

export interface RemoteReminder {
  id: string;
  gearId: string;
  name: string;
  distanceM: number;   // interval, meters (0 = not distance-based)
  timeS: number;       // interval, seconds
  days: number;        // interval, days
  activities: number;  // interval, activity count
  percentUsed: number; // intervals' own score, 0..100+ (kept as a cross-check / fallback)
  snoozedUntil: number | null; // epoch ms or null
  // Reset-baseline — the gear's cumulative counters at the reminder's last reset. Lets the app
  // compute due-ness LOCALLY (used = gear-total-now − starting) without intervals' percent_used.
  startingDistanceM: number;
  startingTimeS: number;
  startingActivities: number;
  lastReset: number | null; // epoch ms of the last reset (for days-based reminders)
}

function num(v: any): number { const n = Number(v); return Number.isFinite(n) ? n : 0; }

export function normReminder(r: any): RemoteReminder {
  const snoozed = r.snoozed_until ?? r.snoozedUntil;
  const reset = r.last_reset ?? r.lastReset;
  return {
    id: String(r.id ?? ''),
    gearId: String(r.gear_id ?? r.gearId ?? ''),
    name: String(r.name ?? ''),
    distanceM: num(r.distance),
    timeS: num(r.time),
    days: num(r.days),
    activities: num(r.activities),
    percentUsed: num(r.percent_used ?? r.percentUsed),
    snoozedUntil: snoozed ? (Date.parse(String(snoozed)) || null) : null,
    startingDistanceM: num(r.starting_distance ?? r.startingDistanceM),
    startingTimeS: num(r.starting_time ?? r.startingTimeS),
    startingActivities: num(r.starting_activities ?? r.startingActivities),
    lastReset: reset ? (Date.parse(String(reset)) || null) : null,
  };
}

export function normGear(g: any): RemoteGear {
  const rawIds = g.component_ids ?? g.componentIds;
  return {
    id: String(g.id ?? ''),
    name: String(g.name ?? ''),
    type: String(g.type ?? 'Bike'),
    component: !!g.component,
    componentIds: Array.isArray(rawIds) ? rawIds.map((x: any) => String(x)) : [],
    distanceM: num(g.distance),
    timeS: num(g.time),
    retired: g.retired === true, // nullable: null/false => not retired
    reminders: Array.isArray(g.reminders) ? g.reminders.map(normReminder) : [],
  };
}

/** Whether a `type` string denotes a top-level bike/shoe (vs a component part type). */
export function isTopLevelType(type: string): boolean {
  const t = type.toLowerCase();
  return t === 'bike' || t === 'shoes' || t === 'shoe';
}

/** remoteChildId -> remoteParentId, inverted from every parent's component_ids. */
export function buildParentMap(remotes: RemoteGear[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const g of remotes) for (const childId of g.componentIds) m.set(childId, g.id);
  return m;
}
