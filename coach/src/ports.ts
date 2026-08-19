// The three pluggable seams. A backend is anything that implements one of these.
// The coach depends on these interfaces — never on a concrete adapter.

import type {
  Sport, Activity, ReadinessSignals, RiderProfile, LibraryWorkout,
} from './model.ts';

/** WHERE workouts come from — the catalogue you prescribe from. */
export interface LibrarySource {
  id: string;
  search(q: {
    sport?: Sport;
    maxDurationSec?: number;
    intensity?: LibraryWorkout['intensity'];
  }): Promise<LibraryWorkout[]>;
  get(id: string): Promise<LibraryWorkout>;
}

/** WHERE your history + readiness signals come from — the local ⇄ intervals toggle. */
export interface HistorySource {
  id: string;
  activities(sinceDays: number): Promise<Activity[]>;         // feeds the fitness model
  readinessSignals(date: string): Promise<ReadinessSignals>;  // may return {} (Ambit3)
  profile(): Promise<RiderProfile>;
}

/** WHERE a planned workout lands — the device. */
export interface DeviceSink {
  id: string;
  capabilities(): { guided: boolean; power: boolean; pace: boolean };
  push(w: LibraryWorkout): Promise<{ ok: boolean; note: string }>;
}
