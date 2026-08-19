// The canonical model — the only shapes the coach ever touches.
// Every backend (SYSTM, intervals.icu, Suunto, a local DB) maps INTO these.
// Keep it minimal: just what the readiness light and the planner need.

export type Sport = 'cycling' | 'running' | 'swimming' | 'strength' | 'other';

/** One completed session, normalized. */
export interface Activity {
  id: string;
  date: string;            // "2026-08-18"
  sport: Sport;
  durationSec: number;
  load: number;            // TSS-equivalent — the ONE number the fitness model needs
  loadSource: 'power' | 'hr' | 'rpe';   // power TSS | hrTSS | sRPE, interchangeable
  avgHr?: number;
  intensityFactor?: number;
}

/** Readiness INPUTS: whatever a source can offer, all optional. */
export interface ReadinessSignals {
  hrv?: number;            // Race S / intervals give this; the Ambit3 gives nothing
  restingHr?: number;
  sleepScore?: number;     // 0..100
  subjectiveNote?: string;
}

/** Readiness OUTPUT: the light plus the numbers behind it. */
export interface Readiness {
  fitness: number;         // CTL  -> "Fitness"
  fatigue: number;         // ATL  -> "Fatigue"
  freshness: number;       // TSB  -> "Freshness"
  rampPerWeek: number;
  light: Light;
  sentence: string;        // the human line
  basis: ('load' | 'hrv' | 'sleep')[];   // which signals actually fed it
}

export type Light = 'green' | 'tempered' | 'yellow' | 'red';

export interface RiderProfile {
  mainSports: Sport[];
  secondarySports: Sport[];
  weatherMatters: boolean;
  recoveryMenu: string[];  // walk, breathing, stretching, ...
  ftp?: number;            // scales %FTP targets
  thresholdPaceSecPerKm?: number;
  maxHr?: number;
}

/** A prescribable session from any library. */
export interface LibraryWorkout {
  id: string;
  name: string;
  sport: Sport;
  durationSec: number;
  load?: number;
  intensity: WorkoutIntensity;   // maps to the light
  steps: WorkoutStep[];
  source: string;                // 'systm' | 'preset' | ...
}

export type WorkoutIntensity = 'recovery' | 'endurance' | 'tempo' | 'hard';

export interface WorkoutStep {
  durationSec?: number;
  distanceM?: number;
  intensity: 'warmup' | 'active' | 'rest' | 'cooldown';
  target: Target;
  name?: string;
}

// Targets are relative, so they survive any device and any FTP/threshold.
export type Target =
  | { kind: 'ftpPct'; low: number; high: number }
  | { kind: 'thresholdPacePct'; low: number; high: number }
  | { kind: 'hrPct'; low: number; high: number }
  | { kind: 'open'; label?: string };
