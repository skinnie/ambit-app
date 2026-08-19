// The coach core. Imports model + ports and NOTHING else — no SYSTM, no intervals,
// no Suunto. Swap every adapter and not one line in here changes.

import type {
  Activity, ReadinessSignals, Readiness, Light, RiderProfile, LibraryWorkout,
} from './model.ts';
import type { LibrarySource, DeviceSink } from './ports.ts';

const AC = 1 - Math.exp(-1 / 42);   // Fitness (CTL) time constant
const AA = 1 - Math.exp(-1 / 7);    // Fatigue (ATL) time constant

/**
 * Fitness/Fatigue/Freshness from load. HRV & sleep, when present, can only ever
 * nudge the light MORE cautious — never less. So it works sensor-rich or sensor-poor.
 */
export function computeReadiness(acts: Activity[], sig: ReadinessSignals): Readiness {
  const daily = toDaily(acts);
  const ctlSeries: number[] = [];
  let ctl = 0, atl = 0;
  for (const load of daily) {
    ctl = ctl * (1 - AC) + load * AC;
    atl = atl * (1 - AA) + load * AA;
    ctlSeries.push(ctl);
  }
  const tsb = ctl - atl;
  const ramp = buildRate(ctlSeries);

  let light: Light = tsb > -10 ? 'green' : tsb > -25 ? 'yellow' : 'red';
  const basis: Readiness['basis'] = ['load'];

  if (light === 'green' && ramp > 7) light = 'tempered';               // ramp check
  if (sig.hrv !== undefined) { basis.push('hrv'); if (belowBaseline(sig.hrv)) light = damp(light); }
  if (sig.sleepScore !== undefined) { basis.push('sleep'); if (sig.sleepScore < 50) light = damp(light); }

  return { fitness: ctl, fatigue: atl, freshness: tsb, rampPerWeek: ramp, light, sentence: say(light), basis };
}

/** Today's options: the light picks the menu; the library is whatever adapter you plugged in. */
export async function recommend(
  profile: RiderProfile, r: Readiness, lib: LibrarySource, minutes: number,
): Promise<LibraryWorkout[]> {
  const intensity =
    r.light === 'red' ? 'recovery' :
    r.light === 'green' ? 'hard' :
    r.light === 'tempered' ? 'endurance' : 'endurance';
  return lib.search({ sport: profile.mainSports[0], maxDurationSec: minutes * 60, intensity });
}

/** Send it: ask the sink what it can do, then push. The coach doesn't care which device. */
export async function sendToWatch(w: LibraryWorkout, sink: DeviceSink) {
  return sink.push(w);
}

// ---- helpers ----------------------------------------------------------------

function toDaily(acts: Activity[]): number[] {
  if (acts.length === 0) return [];
  const by = new Map<string, number>();
  for (const a of acts) by.set(a.date, (by.get(a.date) ?? 0) + a.load);
  const dates = [...by.keys()].sort();
  const out: number[] = [];
  const cur = new Date(dates[0] + 'T00:00:00Z');
  const end = new Date(dates[dates.length - 1] + 'T00:00:00Z');
  while (cur <= end) {
    out.push(by.get(cur.toISOString().slice(0, 10)) ?? 0);
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

function buildRate(ctl: number[]): number {   // peak 7-day CTL rise over the last 28 days
  let m = 0;
  for (let i = ctl.length - 1; i >= Math.max(7, ctl.length - 28); i--) m = Math.max(m, ctl[i] - ctl[i - 7]);
  return m;
}

function damp(l: Light): Light {   // one step more cautious, never less
  return l === 'green' ? 'tempered' : l === 'tempered' ? 'yellow' : l === 'yellow' ? 'red' : 'red';
}

function belowBaseline(_hrv: number): boolean {
  // stub: real impl compares against the rider's rolling HRV baseline (e.g. 7-day ln-rMSSD).
  return false;
}

function say(l: Light): string {
  switch (l) {
    case 'green':    return "You're rested. Go hard if you feel like it — and if you've got a plan, follow it.";
    case 'tempered': return "You're fresh, but you've built up fast this month — ease into the hard days.";
    case 'yellow':   return "You're carrying some fatigue. See how you feel, and adapt if you need to.";
    case 'red':      return "Listen to your body and mind. Lean toward full rest, an easy spin, or something gentle.";
  }
}
