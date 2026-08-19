// HistorySource backed by local data (your app's DB / SYSTM cache). This is the DEFAULT.
// The Ambit3 has no HRV/sleep, so readinessSignals() returns {} and the light falls back
// to the load-only fitness model — which is exactly the point.
//
// The intervals.icu counterpart is the same interface with three different method bodies:
//   activities  -> GET /activities        readinessSignals -> GET /wellness (hrv, sleep)
// Swapping local <-> intervals is one line in wireup — the coach never notices.

import type { HistorySource } from '../ports.ts';
import type { Activity, ReadinessSignals, RiderProfile } from '../model.ts';

export class LocalHistory implements HistorySource {
  id = 'local';
  private acts: Activity[];

  // In the real app this is a SQLite query. Here we synthesize a settled training
  // block (~4 months steady, then a taper) so the demo is deterministic and offline.
  constructor(acts: Activity[] = sampleBlock()) {
    this.acts = acts;
  }

  async activities(sinceDays: number): Promise<Activity[]> {
    const cutoff = daysAgoISO(sinceDays);
    return this.acts.filter(a => a.date >= cutoff);
  }

  async readinessSignals(_date: string): Promise<ReadinessSignals> {
    return {};   // Ambit3: no HRV, no sleep — the model copes
  }

  async profile(): Promise<RiderProfile> {
    return {
      mainSports: ['cycling'],
      secondarySports: ['running'],
      weatherMatters: true,
      recoveryMenu: ['walk', 'breathing', 'stretching'],
      ftp: 250,
      maxHr: 186,
    };
  }
}

// --- deterministic sample: 116 days @ ~60 TSS, then 10 easy days -> rested (green) ---
function sampleBlock(): Activity[] {
  const out: Activity[] = [];
  const total = 126;
  for (let i = total - 1; i >= 0; i--) {
    const load = i < 10 ? 15 : 60;              // last 10 days easy = taper
    out.push({
      id: `s${i}`, date: daysAgoISO(i), sport: 'cycling',
      durationSec: Math.round(load * 45), load, loadSource: 'hr',
    });
  }
  return out;
}

function daysAgoISO(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}
