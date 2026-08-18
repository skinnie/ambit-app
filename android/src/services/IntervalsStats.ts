import { getIntervalsIcuCredentials } from './ApiIntervalsIcu';

// JS port of tools/intervals_stats.py's activity-class calc — the only stat refreshed on every
// sync (André, 2026-08-18: "recalculate activity level on each sync usb and bluetooth"). The
// Suunto activity class is derived from real training: the 4-week average weekly moving-hours,
// mapped to SuuntoLink's own hour ladder (verified against the Ambit3 Personal-settings
// screens): 4=<30min, 5=30-60min, 6=1-3h, 7=>3h, 7.5=5-7h, 8=7-9h, 8.5=9-11h, 9=11-13h,
// 9.5=13-15h, 10=>15h; class 1 when the window has no training. (2-3 are light recreational,
// left for manual selection — a bare hours total can't tell "heavy" from "light".)
const API_BASE = 'https://intervals.icu/api/v1';

const CLASS_LADDER: Array<[number, number]> = [
  [0.5, 4.0], [1.0, 5.0], [3.0, 6.0], [5.0, 7.0], [7.0, 7.5],
  [9.0, 8.0], [11.0, 8.5], [13.0, 9.0], [15.0, 9.5], [Infinity, 10.0],
];

export function activityClassFromWeeklyHours(hoursPerWeek: number): number {
  for (const [upper, cls] of CLASS_LADDER) if (hoursPerWeek < upper) return cls;
  return 10.0;
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Compute the athlete's current Suunto activity class from their last `weeks` weeks of
 * intervals.icu training. Returns null when intervals.icu isn't connected (nothing to do). */
export async function computeActivityClass(weeks = 4): Promise<number | null> {
  const creds = await getIntervalsIcuCredentials();
  if (!creds) return null;

  const newest = new Date();
  const oldest = new Date(newest.getTime() - weeks * 7 * 24 * 3600 * 1000);
  const url = `${API_BASE}/athlete/${encodeURIComponent(creds.athleteId)}/activities`
    + `?oldest=${ymd(oldest)}&newest=${ymd(newest)}`;
  // Basic auth, same as the rest of ApiIntervalsIcu; an explicit UA (intervals.icu 403s some
  // default agents).
  const resp = await fetch(url, {
    headers: { Authorization: 'Basic ' + btoa(`API_KEY:${creds.apiKey}`), 'User-Agent': 'Sommet/1.0' },
  });
  if (!resp.ok) throw new Error(`intervals.icu activities: HTTP ${resp.status}`);
  const acts = await resp.json();
  if (!Array.isArray(acts) || acts.length === 0) return 1.0;

  let totalS = 0;
  for (const a of acts) totalS += Number(a?.moving_time ?? a?.elapsed_time ?? 0) || 0;
  return activityClassFromWeeklyHours((totalS / 3600) / weeks);
}
