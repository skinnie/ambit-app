// DeviceSink for the legacy Ambit3 / Traverse — the endgame, and the one only you can do.
//
// The Ambit3 has NO on-watch interval engine. Its TrainingProgram region stores a
// "planned move" (see tools/training_program.py build_training_item): activityId +
// duration(min) + distance(m) + intensity + a date (base_date + dayOffset). So a rich
// interval workout collapses to ONE scheduled session — the watch shows activity/duration/
// distance on its day screen, and records the move. The per-step targets are dropped,
// because the device genuinely can't hold them. capabilities() says so honestly; pair this
// sink with FitExportSink when you also want the intervals on a head unit.
//
// Offline + runnable: push() builds the move and hands it to a pluggable transport
// (default dry-run). The live transport POSTs to the app's Python backend, which runs
// tools/training_program.py against the connected watch (USB/BLE) — that's the one swap.

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { DeviceSink } from '../ports.ts';
import type { LibraryWorkout, Sport, WorkoutIntensity } from '../model.ts';

// mirrors tools/training_program.py build_training_item()
export interface AmbitMove {
  name: string;
  activityId: number;   // Suunto catalog id (see note below)
  durationMin: number;
  distanceM: number;
  intensity: number;    // 1..5
  dayOffset: number;    // date = base_date + dayOffset
}

export type AmbitTransport = (move: AmbitMove) => Promise<{ ok: boolean; note: string }>;

export class Ambit3Sink implements DeviceSink {
  id = 'ambit3';
  private transport: AmbitTransport;
  private dayOffset: number;

  constructor(opts: { transport?: AmbitTransport; dayOffset?: number } = {}) {
    this.transport = opts.transport ?? dryRun;
    this.dayOffset = opts.dayOffset ?? 0;
  }

  capabilities() {
    // A scheduled planned move — no guided steps, no enforced targets. The Ambit3's ceiling.
    return { guided: false, power: false, pace: false };
  }

  async push(w: LibraryWorkout): Promise<{ ok: boolean; note: string }> {
    return this.transport(toAmbitMove(w, this.dayOffset));
  }
}

// canonical LibraryWorkout -> one Ambit planned move (the whole session, no steps)
function toAmbitMove(w: LibraryWorkout, dayOffset: number): AmbitMove {
  const distanceM = w.steps.reduce((t, s) => t + (s.distanceM ?? 0), 0);
  return {
    name: w.name.slice(0, 24),   // watch name field is short
    activityId: activityIdFor(w.sport),
    durationMin: Math.round(w.durationSec / 60),
    distanceM: Math.round(distanceM),
    intensity: intensityFor(w.intensity),
    dayOffset,
  };
}

// NOTE: replace with the project's canonical activity catalog (tools/apps.py / assets index).
// apps.py confirms the region uses Suunto's real catalog activityId values; 3 is the tool default.
function activityIdFor(sport: Sport): number {
  switch (sport) {
    case 'running':  return 1;
    case 'cycling':  return 2;
    case 'swimming': return 12;
    default:         return 3;   // training_program.py default
  }
}

function intensityFor(i: WorkoutIntensity): number {
  return i === 'recovery' ? 1 : i === 'endurance' ? 2 : i === 'tempo' ? 3 : 4;
}

const dryRun: AmbitTransport = async (m) => {
  const outDir = fileURLToPath(new URL('../../out/', import.meta.url));
  const file = `${outDir}${slug(m.name)}.ambit-move.json`;
  writeFileSync(file, JSON.stringify(m, null, 2));
  return {
    ok: true,
    note: `planned move: activity ${m.activityId} · ${m.durationMin} min`
        + `${m.distanceM ? ' · ' + m.distanceM + ' m' : ''} · intensity ${m.intensity} · day+${m.dayOffset} `
        + `-> ${file.split('/').slice(-2).join('/')}  (interval detail dropped — Ambit3 stores a move, `
        + `not steps; POST to backend -> tools/training_program.py --write to send)`,
  };
};

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
