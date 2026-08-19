// DeviceSink for the Ambit3 via a Suunto App (App Zone) — real ON-WATCH guidance.
//
// Unlike the planned-move sink (a calendar entry) and unlike SuuntoPlus (HR only), an App
// Zone app watches the live built-ins (SUUNTO_BIKE_POWER / SUUNTO_HR / SUUNTO_PACE) every
// tick and beeps when you leave the target range — so power/HR/pace targets are REAL here.
//
// It maps canonical steps onto tools/workout.py's reverse-engineered App-Zone workout JSON
// (Findings 5/8/9/10). It STOPS at that spec — compilation is a separate, deliberate step:
// workout.py's own note says the community compiler "is not ours to invoke on a user's
// behalf" (compile on ambitapps.z6.web.core.windows.net, or via tools/training_plan.py's
// backend path). This adapter never touches the parked offline compiler.
//
// Ceiling to respect: every step is one PHASE branch, so long workouts hit BINARY_TOO_LARGE.
// App Zone suits short structured sessions (~<=20 phases), NOT dense 50-200 step SYSTM rides
// — for those on an Ambit3, use the planned-move sink + a FIT on a head unit.

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { DeviceSink } from '../ports.ts';
import type { LibraryWorkout, WorkoutStep, Target } from '../model.ts';

const PHASE_SOFT_LIMIT = 20;   // beyond this, the compiler will likely reject/split (BINARY_TOO_LARGE)

// tools/workout.py schema
interface AzStep {
  type: { typeName: 'warmup' | 'interval' | 'recovery' | 'cooldown' };
  duration: { durationName: 'time' | 'distance'; value: number };
  target: { targetName: 'none' | 'power' | 'hr' | 'pace'; valueRange?: { min: number; max: number } };
}
export interface AzWorkout { name: string; steps: AzStep[]; }

export interface AmbitAppOpts {
  ftp?: number; maxHr?: number; thresholdPaceSecPerKm?: number;
  transport?: (w: AzWorkout) => Promise<{ ok: boolean; note: string }>;
}

export class Ambit3AppSink implements DeviceSink {
  id = 'ambit3-app';
  private o: AmbitAppOpts;
  constructor(opts: AmbitAppOpts = {}) { this.o = opts; }

  capabilities() {
    // App Zone enforces power/HR/pace live — the richest guidance the Ambit3 can do.
    return { guided: true, power: true, pace: true };
  }

  async push(w: LibraryWorkout): Promise<{ ok: boolean; note: string }> {
    const az = toAppZoneWorkout(w, this.o);
    return (this.o.transport ?? dryRun)(az);
  }
}

function toAppZoneWorkout(w: LibraryWorkout, o: AmbitAppOpts): AzWorkout {
  return { name: w.name.slice(0, 24), steps: w.steps.map(s => toAzStep(s, o)) };
}

function toAzStep(s: WorkoutStep, o: AmbitAppOpts): AzStep {
  const type =
    s.intensity === 'warmup' ? 'warmup' :
    s.intensity === 'cooldown' ? 'cooldown' :
    s.intensity === 'rest' ? 'recovery' : 'interval';
  const duration = s.distanceM
    ? { durationName: 'distance' as const, value: Math.round(s.distanceM) }
    : { durationName: 'time' as const, value: Math.round(s.durationSec ?? 0) };
  return { type: { typeName: type }, duration, target: toAzTarget(s.target, o) };
}

// relative canonical targets -> the App Zone's absolute built-ins (needs the rider's numbers)
function toAzTarget(t: Target, o: AmbitAppOpts): AzStep['target'] {
  const band = (lo: number, hi: number) => (lo === hi ? [lo - 4, hi + 4] : [lo, hi]); // ±4% for a point target
  if (t.kind === 'ftpPct' && o.ftp) {
    const [lo, hi] = band(t.low, t.high);
    return { targetName: 'power', valueRange: { min: Math.round((o.ftp * lo) / 100), max: Math.round((o.ftp * hi) / 100) } };
  }
  if (t.kind === 'hrPct' && o.maxHr) {
    const [lo, hi] = band(t.low, t.high);
    return { targetName: 'hr', valueRange: { min: Math.round((o.maxHr * lo) / 100), max: Math.round((o.maxHr * hi) / 100) } };
  }
  if (t.kind === 'thresholdPacePct' && o.thresholdPaceSecPerKm) {
    // pace: lower sec/km = faster. % of threshold pace -> sec/km. Unit = SUUNTO_PACE (verify on-watch).
    const p = o.thresholdPaceSecPerKm;
    const lo = Math.round((p * 100) / t.high), hi = Math.round((p * 100) / t.low);
    return { targetName: 'pace', valueRange: { min: lo, max: hi } };
  }
  return { targetName: 'none' };   // no rider number, or an 'open' step
}

const dryRun = async (w: AzWorkout): Promise<{ ok: boolean; note: string }> => {
  const outDir = fileURLToPath(new URL('../../out/', import.meta.url));
  const file = `${outDir}${slug(w.name)}.appzone-workout.json`;
  writeFileSync(file, JSON.stringify(w, null, 2));
  const phases = w.steps.length;
  const targeted = w.steps.filter(s => s.target.targetName !== 'none').length;
  const tooBig = phases > PHASE_SOFT_LIMIT;
  return {
    ok: !tooBig,
    note: `${phases} phases (${targeted} targeted) -> ${file.split('/').slice(-2).join('/')}  `
        + (tooBig
            ? `⚠ >${PHASE_SOFT_LIMIT} phases: likely BINARY_TOO_LARGE — App Zone suits short sessions; `
            + `use the planned-move sink + FIT for dense rides.`
            : `feed to tools/workout.py -> compile on the community site (not auto-invoked).`),
  };
};

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
