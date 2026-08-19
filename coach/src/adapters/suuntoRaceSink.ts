// DeviceSink for a modern Suunto (Race S, 9, Vertical…) via SuuntoPlus Guides.
//
// It maps our canonical steps onto suunto-mcp's IntervalPlan shape (see guide-zip.ts):
// auto-advance by time/distance, HR-range targets, and notification text. Reality of the
// format — the sink is honest about it via capabilities():
//   • HR targets  -> real enforced ranges (targetHrMin/Max), needs the rider's maxHr
//   • power/pace  -> Guides can't enforce these, so they ride along as notifyText
//                    ("75% FTP") while the step auto-advances on time.
//
// The build is offline + runnable: push() constructs the guide and hands it to a pluggable
// `transport`. Default = dry-run (writes the guide JSON, prints a summary). To go live, pass
// a transport that calls your forked suunto-mcp `push_workout_guide` — that's the one swap.

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { DeviceSink } from '../ports.ts';
import type { LibraryWorkout, WorkoutStep, Target } from '../model.ts';

// ---- suunto-mcp IntervalPlan shape (from guide-zip.ts) ----
export interface IntervalSegment {
  label: string;
  durationSec?: number;   // auto-advance trigger
  distanceM?: number;
  targetHrMin?: number;
  targetHrMax?: number;
  notifyText?: string;
}
export interface IntervalBlock { times?: number; segments: IntervalSegment[]; }
export interface IntervalPlan { title: string; date: string; blocks: IntervalBlock[]; }

export type GuideTransport = (plan: IntervalPlan) => Promise<{ ok: boolean; note: string }>;

export class SuuntoRaceSink implements DeviceSink {
  id = 'suunto-race';
  private maxHr?: number;
  private transport: GuideTransport;

  constructor(opts: { maxHr?: number; transport?: GuideTransport } = {}) {
    this.maxHr = opts.maxHr;
    this.transport = opts.transport ?? dryRun;
  }

  capabilities() {
    // Guides enforce HR ranges, auto-advance by time/distance, and show text.
    // They do NOT enforce power or pace — those become on-screen prompts.
    return { guided: true, power: false, pace: false };
  }

  async push(w: LibraryWorkout): Promise<{ ok: boolean; note: string }> {
    return this.transport(toIntervalPlan(w, this.maxHr));
  }
}

// canonical LibraryWorkout -> SuuntoPlus IntervalPlan. The only real work in the adapter.
function toIntervalPlan(w: LibraryWorkout, maxHr?: number): IntervalPlan {
  const segments: IntervalSegment[] = w.steps.map(step => toSegment(step, maxHr));
  return {
    title: w.name.slice(0, 40),
    date: new Date().toISOString().slice(0, 10),
    blocks: [{ times: 1, segments }],   // steps are pre-expanded, so one flat block
  };
}

function toSegment(step: WorkoutStep, maxHr?: number): IntervalSegment {
  const seg: IntervalSegment = {
    label: step.name ?? targetLabel(step.target),
    durationSec: step.durationSec,
    distanceM: step.distanceM,
  };
  if (step.target.kind === 'hrPct' && maxHr) {
    seg.targetHrMin = Math.round((maxHr * step.target.low) / 100);
    seg.targetHrMax = Math.round((maxHr * step.target.high) / 100);
  } else {
    seg.notifyText = targetLabel(step.target);   // power/pace/open -> shown, not enforced
  }
  return seg;
}

function targetLabel(t: Target): string {
  switch (t.kind) {
    case 'ftpPct':           return t.low === t.high ? `${t.low}% FTP` : `${t.low}-${t.high}% FTP`;
    case 'thresholdPacePct': return t.low === t.high ? `${t.low}% pace` : `${t.low}-${t.high}% pace`;
    case 'hrPct':            return `${t.low}-${t.high}% HR`;
    case 'open':             return t.label ?? 'easy';
  }
}

// default offline transport: write the guide, summarize what the watch would do
const dryRun: GuideTransport = async (plan) => {
  const outDir = fileURLToPath(new URL('../../out/', import.meta.url));
  const file = `${outDir}${slug(plan.title)}.suunto-guide.json`;
  writeFileSync(file, JSON.stringify(plan, null, 2));
  const segs = plan.blocks.reduce((n, b) => n + (b.times ?? 1) * b.segments.length, 0);
  const hr = plan.blocks.some(b => b.segments.some(s => s.targetHrMin !== undefined));
  return {
    ok: true,
    note: `${segs} segments, ${hr ? 'HR-targeted' : 'text-targeted'} -> `
        + `${file.split('/').slice(-2).join('/')} (wire transport to suunto-mcp push_workout_guide to send)`,
  };
};

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
