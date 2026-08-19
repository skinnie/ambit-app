// DeviceSink that writes a FIT-ready plan. Works on ANY device, today.
//
// This stub emits the canonical steps as JSON (so the demo is dependency-free). The real
// bytes come from the proven Python fit_tool pipeline in tools/ (the same one that built
// the 520 SYSTM FITs): %FTP -> custom_target_value = 1000 + pct. Two sibling sinks share
// this exact interface:
//   SuuntoRaceSink  -> suunto-mcp `push_workout_guide` (SuuntoPlus Guide, modern watches)
//   Ambit3Sink      -> your BLE/USB Training-Program writer (legacy watches, the moat)

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { DeviceSink } from '../ports.ts';
import type { LibraryWorkout } from '../model.ts';

export class FitExportSink implements DeviceSink {
  id = 'fit';

  capabilities() {
    return { guided: false, power: true, pace: true };
  }

  async push(w: LibraryWorkout): Promise<{ ok: boolean; note: string }> {
    const outDir = fileURLToPath(new URL('../../out/', import.meta.url));
    const file = `${outDir}${slug(w.name)}.plan.json`;
    writeFileSync(file, JSON.stringify({ name: w.name, sport: w.sport, steps: w.steps }, null, 2));
    const secs = w.steps.reduce((t, s) => t + (s.durationSec ?? 0), 0);
    return {
      ok: true,
      note: `${w.steps.length} steps / ${Math.round(secs / 60)} min -> ${file.split('/').slice(-2).join('/')} `
          + `(feed to tools/ fit_tool writer for the real .fit)`,
    };
  }
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
