// The whole "toggle", in one place — then the coach just runs.
// Run:  node --experimental-strip-types src/demo.ts   (Node 22+)
//   or: npm run demo

import type { HistorySource, DeviceSink, LibrarySource } from './ports.ts';
import { SystmLibrary } from './adapters/systmLibrary.ts';
import { LocalHistory } from './adapters/localHistory.ts';
import { IntervalsHistory } from './adapters/intervalsHistory.ts';
import { FitExportSink } from './adapters/fitSink.ts';
import { SuuntoRaceSink } from './adapters/suuntoRaceSink.ts';
import { Ambit3Sink } from './adapters/ambit3Sink.ts';
import { Ambit3AppSink } from './adapters/ambit3AppSink.ts';
import { computeReadiness, recommend, sendToWatch } from './coach.ts';

// the sink half of the toggle. FIT is the safe fallback; the rest are real.
type SinkOpts = { ftp?: number; maxHr?: number; thresholdPaceSecPerKm?: number };
function pickSink(device: string, o: SinkOpts): DeviceSink {
  switch (device) {
    case 'suunto-race': return new SuuntoRaceSink({ maxHr: o.maxHr });
    case 'ambit3':      return new Ambit3Sink();                    // planned move (calendar)
    case 'ambit3-app':  return new Ambit3AppSink(o);               // App Zone guided workout
    case 'fit':
    default:            return new FitExportSink();
  }
}

// --- config (in the real app: user settings; here: env-overridable to show the toggle)
//   SOURCE=local|intervals   DEVICE=fit|suunto-race|ambit3   MINUTES=60
const cfg = {
  source: process.env.SOURCE ?? 'local',
  device: process.env.DEVICE ?? 'fit',
  minutes: Number(process.env.MINUTES ?? 60),
};

// --- wire-up: pick adapters. Local-first; FIT is the safe fallback sink -------
const history: HistorySource =
  cfg.source === 'intervals'
    ? new IntervalsHistory({ athleteId: process.env.ICU_ATHLETE, apiKey: process.env.ICU_KEY })
    : new LocalHistory();   // local-first; intervals runs on sample data unless ICU_* are set

const library: LibrarySource = new SystmLibrary();
// (the device sink is built after we know the rider's maxHr, below)

// --- run: readiness -> recommend -> push. None of this names a backend --------
const bar = (s: string) => console.log('\n\x1b[36m' + s + '\x1b[0m');

const acts = await history.activities(180);
const signals = await history.readinessSignals(today());
const profile = await history.profile();
const sink: DeviceSink = pickSink(cfg.device, {
  ftp: profile.ftp, maxHr: profile.maxHr, thresholdPaceSecPerKm: profile.thresholdPaceSecPerKm,
});

const readiness = computeReadiness(acts, signals);
const dot = { green: '🟢', tempered: '🌿', yellow: '🟡', red: '🔴' }[readiness.light];

bar('TODAY  (source: ' + history.id + ')');
console.log(`${dot}  ${cap(readiness.light)}`);
console.log(`   ${readiness.sentence}`);
console.log(`   Fitness ${readiness.fitness.toFixed(0)} · Fatigue ${readiness.fatigue.toFixed(0)} · `
          + `Freshness ${readiness.freshness > 0 ? '+' : ''}${readiness.freshness.toFixed(0)} · `
          + `ramp ${readiness.rampPerWeek.toFixed(1)}/wk · basis [${readiness.basis.join(', ')}]`);

bar(`INDOOR PICKS  (${cfg.minutes} min, library: ${library.id})`);
const picks = await recommend(profile, readiness, library, cfg.minutes);
for (const w of picks) {
  console.log(`   • ${w.name.padEnd(34)} ${fmt(w.durationSec)}  ${w.intensity.padEnd(9)} `
            + `TSS ${w.load}  (${w.steps.length} steps)`);
}

bar(`SEND  (device: ${sink.id}, guided=${sink.capabilities().guided})`);
if (picks[0]) {
  const res = await sendToWatch(picks[0], sink);
  console.log(`   ${res.ok ? '✓' : '✗'} ${picks[0].name}: ${res.note}`);
}
console.log('');

// --- tiny formatters ---------------------------------------------------------
function fmt(sec: number) { const m = Math.round(sec / 60); return m >= 60 ? `${(m / 60 | 0)}:${String(m % 60).padStart(2, '0')}` : `${m}m`; }
function cap(s: string) { return s[0].toUpperCase() + s.slice(1); }
function today() { return new Date().toISOString().slice(0, 10); }
