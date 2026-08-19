// LibrarySource backed by SYSTM data. Here it reads a local catalogue file (offline,
// local-first). To go live, swap `loadCatalogue()` for a call into a forked
// wahoo-systm-mcp (the GraphQL at api.thesufferfest.com) — the mapping below is unchanged.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { LibrarySource } from '../ports.ts';
import type { LibraryWorkout, WorkoutIntensity, WorkoutStep } from '../model.ts';

// shape of a row in the local SYSTM catalogue (name, TSS, IF, duration, merged [sec,%FTP] steps)
interface SystmRow { name: string; tss: number; if: number; dur: number; steps: [number, number][]; }

export class SystmLibrary implements LibrarySource {
  id = 'systm';
  private rows: SystmRow[];

  constructor(catalogue?: SystmRow[]) {
    this.rows = catalogue ?? loadCatalogue();
  }

  async search(q: {
    sport?: string; maxDurationSec?: number; intensity?: WorkoutIntensity;
  }): Promise<LibraryWorkout[]> {
    if (q.sport && q.sport !== 'cycling') return [];   // this catalogue is cycling
    return this.rows
      .map(toLibraryWorkout)
      .filter(w => (q.maxDurationSec ? w.durationSec <= q.maxDurationSec : true))
      .filter(w => (q.intensity ? w.intensity === q.intensity : true))
      .sort((a, b) => (b.load ?? 0) - (a.load ?? 0))
      .slice(0, 4);
  }

  async get(id: string): Promise<LibraryWorkout> {
    const row = this.rows.find(r => slug(r.name) === id);
    if (!row) throw new Error(`no workout ${id}`);
    return toLibraryWorkout(row);
  }
}

// SYSTM fields -> canonical LibraryWorkout. This is the ONLY real work in the adapter.
function toLibraryWorkout(r: SystmRow): LibraryWorkout {
  const steps: WorkoutStep[] = r.steps.map(([sec, pct]) => ({
    durationSec: sec,
    intensity: pct <= 55 ? 'rest' : 'active',
    target: { kind: 'ftpPct', low: pct, high: pct },
  }));
  return {
    id: slug(r.name), name: r.name, sport: 'cycling',
    durationSec: r.dur, load: r.tss, intensity: bucket(r.if),
    steps, source: 'systm',
  };
}

// SYSTM has no single "intensity" field, so bucket by IF (live mcp would use category too).
function bucket(intensityFactor: number): WorkoutIntensity {
  if (intensityFactor < 0.60) return 'recovery';
  if (intensityFactor < 0.75) return 'endurance';
  if (intensityFactor < 0.82) return 'tempo';
  return 'hard';
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function loadCatalogue(): SystmRow[] {
  const path = fileURLToPath(new URL('../../data/systm-sample.json', import.meta.url));
  return JSON.parse(readFileSync(path, 'utf8')) as SystmRow[];
}
