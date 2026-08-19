// HistorySource backed by intervals.icu — the other half of the source toggle.
// Same interface as LocalHistory, three different method bodies. This is what makes
// "use intervals data" a config flag instead of a rewrite.
//
// Give it { athleteId, apiKey } and it hits the real API (basic auth: user "API_KEY").
// Give it nothing and it serves bundled sample data, so `SOURCE=intervals` runs offline
// and demonstrates the payoff: real HRV + sleep flow in, and the light gets richer
// (readiness.basis becomes [load, hrv, sleep]) — the Ambit3 can't do that.

import type { HistorySource } from '../ports.ts';
import type { Activity, ReadinessSignals, RiderProfile, Sport } from '../model.ts';

export interface IntervalsOpts {
  athleteId?: string;
  apiKey?: string;
  baseUrl?: string;              // default https://intervals.icu/api/v1
  fetchImpl?: typeof fetch;      // injectable for tests
}

export class IntervalsHistory implements HistorySource {
  id = 'intervals';
  private opts: IntervalsOpts;

  constructor(opts: IntervalsOpts = {}) {
    this.opts = opts;
  }

  private live(): boolean {
    return Boolean(this.opts.apiKey && this.opts.athleteId);
  }

  async activities(sinceDays: number): Promise<Activity[]> {
    if (!this.live()) return sampleActivities();
    const rows = await this.get<IcuActivity[]>(`/activities?oldest=${daysAgoISO(sinceDays)}`);
    return rows.map(toActivity);
  }

  async readinessSignals(date: string): Promise<ReadinessSignals> {
    if (!this.live()) return { hrv: 42, restingHr: 48, sleepScore: 42 };   // sample: poor sleep -> damps
    const w = await this.get<IcuWellness>(`/wellness/${date}`);
    return { hrv: w.hrv, restingHr: w.restingHR, sleepScore: w.sleepScore };
  }

  async profile(): Promise<RiderProfile> {
    if (!this.live()) return sampleProfile();
    const a = await this.get<IcuAthlete>('');
    return toProfile(a);
  }

  // intervals.icu REST: GET /athlete/{id}{path}, basic auth with literal user "API_KEY".
  private async get<T>(path: string): Promise<T> {
    const base = this.opts.baseUrl ?? 'https://intervals.icu/api/v1';
    const url = `${base}/athlete/${this.opts.athleteId}${path}`;
    const auth = 'Basic ' + Buffer.from(`API_KEY:${this.opts.apiKey}`).toString('base64');
    const doFetch = this.opts.fetchImpl ?? fetch;
    const res = await doFetch(url, { headers: { Authorization: auth } });
    if (!res.ok) throw new Error(`intervals.icu ${res.status} on ${path}`);
    return res.json() as Promise<T>;
  }
}

// ---- intervals.icu shapes (only the fields we read) ----
interface IcuActivity {
  id: number | string; type: string; start_date_local?: string; start_date?: string;
  moving_time?: number; elapsed_time?: number; icu_training_load?: number;
  average_heartrate?: number; icu_intensity?: number; icu_ftp?: number;
}
interface IcuWellness { hrv?: number; restingHR?: number; sleepScore?: number; }
interface IcuAthlete { icu_ftp?: number; icu_max_hr?: number; }

// ---- mappers: intervals -> canonical (the real work) ----
function toActivity(a: IcuActivity): Activity {
  return {
    id: String(a.id),
    date: (a.start_date_local ?? a.start_date ?? '').slice(0, 10),
    sport: mapType(a.type),
    durationSec: a.moving_time ?? a.elapsed_time ?? 0,
    load: a.icu_training_load ?? 0,
    loadSource: a.icu_ftp ? 'power' : 'hr',
    avgHr: a.average_heartrate,
    intensityFactor: a.icu_intensity != null ? a.icu_intensity / 100 : undefined,
  };
}

function mapType(t: string): Sport {
  if (/ride|cycl|virtualride/i.test(t)) return 'cycling';
  if (/run/i.test(t)) return 'running';
  if (/swim/i.test(t)) return 'swimming';
  if (/weight|strength|gym/i.test(t)) return 'strength';
  return 'other';
}

function toProfile(a: IcuAthlete): RiderProfile {
  return {
    mainSports: ['cycling'], secondarySports: ['running'],
    weatherMatters: true, recoveryMenu: ['walk', 'breathing', 'stretching'],
    ftp: a.icu_ftp, maxHr: a.icu_max_hr,
  };
}

// ---- offline sample (mirrors the local rested block so the ONLY visible change is the
//      richer readiness basis + the sleep-driven damp) ----
function sampleActivities(): Activity[] {
  const out: Activity[] = [];
  for (let i = 125; i >= 0; i--) {
    const load = i < 10 ? 15 : 60;
    out.push({ id: `i${i}`, date: daysAgoISO(i), sport: 'cycling', durationSec: load * 45, load, loadSource: 'power' });
  }
  return out;
}
function sampleProfile(): RiderProfile {
  return { mainSports: ['cycling'], secondarySports: ['running'], weatherMatters: true,
    recoveryMenu: ['walk', 'breathing', 'stretching'], ftp: 250, maxHr: 186 };
}
function daysAgoISO(n: number): string {
  const d = new Date(); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10);
}
