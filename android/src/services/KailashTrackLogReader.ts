import { base64ToBytes } from './Base64';
import { KailashSession } from './KailashHistoryReader';

// Decodes the Suunto Kailash's `TrackLog` flash region into GPX - a real, confirmed 20-byte
// fixed-stride GPS record format, mirroring the companion research project's
// tools/kailash_tracklog.py exactly (same offsets, same plausibility filter), ground-truth
// validated there against a real 7R app SQLite database (56/56 points exact match). See that
// tool's own docstring for the full story, including a real off-by-one-byte bug it hit and
// fixed before landing on this layout - not re-derived here, just ported.
//
//   record stride: 20 bytes, starting at region offset 1 (byte 0 of the region is a real,
//   still-unexplained leading byte, not part of any record)
//
//   offset  size  field
//   0       4     lat, int32 LE, degrees * 1e7
//   4       4     lon, int32 LE, degrees * 1e7
//   8       4     "third" field - unit/meaning not confirmed, real values cluster
//                 2,000-9,000 - used only as part of the plausibility filter here
//   12      2     year, u16 LE
//   14      1     month
//   15      1     day
//   16      1     hour
//   17      1     minute
//   18      2     two trailing bytes, no confirmed meaning - not surfaced here

export const KAILASH_TRACKLOG_BASE = 0x48a1c0;
export const KAILASH_TRACKLOG_SIZE = 1310713;

const RECORD_START = 1;
const RECORD_SIZE = 20;

interface TrackLogPoint {
  lat: number;
  lon: number;
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

function walkRecords(bytes: Uint8Array): TrackLogPoint[] {
  const points: TrackLogPoint[] = [];
  const n = Math.floor((bytes.length - RECORD_START) / RECORD_SIZE);
  for (let i = 0; i < n; i++) {
    const off = RECORD_START + i * RECORD_SIZE;
    const view = new DataView(bytes.buffer, bytes.byteOffset + off, RECORD_SIZE);
    const lat = view.getInt32(0, true);
    const lon = view.getInt32(4, true);
    const third = view.getInt32(8, true);
    const year = view.getUint16(12, true);
    const month = bytes[off + 14];
    const day = bytes[off + 15];
    const hour = bytes[off + 16];
    const minute = bytes[off + 17];

    const plausible =
      year >= 2015 && year <= 2035 && month >= 1 && month <= 12 && day >= 1 && day <= 31 &&
      hour <= 23 && minute <= 59 &&
      lat >= -900000000 && lat <= 900000000 && lon >= -1800000000 && lon <= 1800000000 &&
      third >= 500 && third <= 50000;

    // Do NOT stop at a run of implausible records. A real mid-track gap (seen live on a
    // Kailash: a 65-min loop whose points resumed after a 6+ record gap at slot 36 - the old
    // `badStreak > 5` break read only the first 15 min, 30 of 112 points) would otherwise
    // truncate the track. The plausibility filter already rejects the region's padding tail
    // record-by-record, and splitIntoActivities() windows the survivors to each session, so
    // scanning the whole region is safe and keeps the full track.
    if (plausible) {
      points.push({ lat: lat / 1e7, lon: lon / 1e7, year, month, day, hour, minute });
    }
  }
  return points;
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

/** GPX for the whole real track, and its own <metadata><time> (matching the convention
 * extractGpxMetadata()/SyncService.ts already read `metadata.time` from for regular Ambit3
 * moves) so this slots into the exact same sync pipeline - see KailashDeviceProvider.ts. */
function pointsToGpx(
  points: TrackLogPoint[],
  summary?: { distanceMeters?: number; durationSeconds?: number },
): string {
  const first = points[0];
  const metaTime = first
    ? `${first.year}-${pad2(first.month)}-${pad2(first.day)}T${pad2(first.hour)}:${pad2(first.minute)}:00Z`
    : '';
  const trkpts = points.map(p => {
    const t = `${p.year}-${pad2(p.month)}-${pad2(p.day)}T${pad2(p.hour)}:${pad2(p.minute)}:00Z`;
    return `    <trkpt lat="${p.lat.toFixed(7)}" lon="${p.lon.toFixed(7)}"><time>${t}</time></trkpt>`;
  }).join('\n');
  // Carry the DeviceHistory session's own distance/duration as <extensions> (the same block
  // shape and the same tags the native Ambit3 GPX uses, which GpxParser + desktop both read).
  // TrackLog is a SPARSE passive log, so a point-to-point sum badly under-reports - the watch's
  // own session summary (5.44 km, not the ~1 km the points straight-line to) is the real value.
  const dur = Math.round(summary?.durationSeconds ?? 0);
  const dist = Math.round(summary?.distanceMeters ?? 0);
  const ext = (dur > 0 || dist > 0)
    ? `    <extensions>\n` +
      (dur > 0 ? `      <duration>${dur}</duration>\n` : '') +
      (dist > 0 ? `      <distance>${dist}</distance>\n` : '') +
      `    </extensions>\n`
    : '';
  return `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<gpx version="1.1" creator="Sommet" xmlns="http://www.topografix.com/GPX/1/1">\n` +
    (metaTime ? `  <metadata><time>${escapeXml(metaTime)}</time></metadata>\n` : '') +
    `  <trk><name>Walking</name>\n${ext}    <trkseg>\n${trkpts}\n  </trkseg></trk>\n</gpx>\n`;
}

/** Decodes a base64 TrackLog region dump (see readRegion() in native/AmbitUsbModule.ts) into
 * one GPX string, or null if no real-looking points were found. */
export function decodeTrackLogToGpx(b64: string): string | null {
  if (!b64) return null;
  const bytes = base64ToBytes(b64);
  const points = walkRecords(bytes);
  if (points.length === 0) return null;
  return pointsToGpx(points);
}

// Real, found live 2026-08-09 debugging "activities still don't show gps track" - direct
// port of tools/kailash_tracklog.py's own SESSION_LOCAL_UTC_OFFSET_HOURS: DeviceHistory's
// LogHeaders.Header.DateTime (KailashSession.when) is the watch's LOCAL time, while
// TrackLog's own embedded year/month/day/hour/minute fields are UTC - two independently-
// decoded clocks with a real, non-obvious offset between them. Confirmed against three
// independent real events the same day: a clean 2-hour local-ahead-of-UTC offset, i.e. CEST
// (France, August). NOT necessarily correct outside daylight saving time or for a watch
// configured to a different timezone - there is no confirmed dynamic offset field to read
// this from instead, so this is real-but-seasonal, worth revisiting outside CEST.
const SESSION_LOCAL_UTC_OFFSET_HOURS = 2;
const MATCH_TOLERANCE_MINUTES = 2;

/** Pulls (year, month, day, hour, minute) out of a real DeviceHistory Header.DateTime string
 * - tolerant of "-"/":"/"T"/" " or no separator at all, same as kailash_tracklog.py's own
 * _parse_when(), since TrackLog's own points are only ever compared at minute resolution
 * anyway. Returns minutes-since-epoch (UTC-naive, matching the points' own field values -
 * there's no real Date object needed here, just comparable integers). */
function parseWhenToMinutes(when: string): number | null {
  const m = /(\d{4})\D?(\d{2})\D?(\d{2})\D?(\d{2})\D?(\d{2})/.exec(when || '');
  if (!m) return null;
  const [, y, mo, d, h, mi] = m.map(Number);
  return Date.UTC(y, mo - 1, d, h, mi) / 60000;
}

function pointMinutes(p: TrackLogPoint): number {
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) / 60000;
}

/** One GPX per real DeviceHistory session, correlating each session's own
 * [when, when + duration] window (converted from local to UTC, +/-2 minutes tolerance)
 * against TrackLog's own per-point timestamps - direct port of kailash_tracklog.py's own
 * split_into_activities(). Real request 2026-08-09 ("Something is bizarre on the
 * activities, they say no gps, but they have gps") - DeviceHistory sessions carry summary
 * stats only (no GPS of their own), and until now KailashDeviceProvider.getLogs() bundled
 * every point from the whole region into one single GPX, with no per-"Walk" correlation at
 * all.
 *
 * Unlike the Python original, sessions with zero correlated points are skipped here rather
 * than returned as an empty-track entry - Android's getLogs() feeds these GPX strings
 * directly into the real local-activity sync pipeline (SyncService.ts), and a synced
 * zero-point activity is a real, deliberate scope trim: this project hasn't verified the
 * rest of that pipeline (GpxParser.ts, ElevationChart.tsx, LogListScreen.tsx) tolerates one
 * gracefully, so this only ever emits activities that actually have a real track. */
export function splitIntoActivities(points: TrackLogPoint[], sessions: KailashSession[]): string[] {
  if (sessions.length === 0) {
    const gpx = points.length > 0 ? pointsToGpx(points) : null;
    return gpx ? [gpx] : [];
  }

  const pointMins = points.map(p => ({ mins: pointMinutes(p), p }));
  const gpxList: string[] = [];
  for (const s of sessions) {
    const startLocal = parseWhenToMinutes(s.when);
    if (startLocal === null) continue;
    const start = startLocal - SESSION_LOCAL_UTC_OFFSET_HOURS * 60;
    const end = start + (s.durationSeconds || 0) / 60;
    const lo = start - MATCH_TOLERANCE_MINUTES;
    const hi = end + MATCH_TOLERANCE_MINUTES;
    const matched = pointMins.filter(({ mins }) => mins >= lo && mins <= hi).map(({ p }) => p);
    if (matched.length > 0) {
      gpxList.push(pointsToGpx(matched, {
        distanceMeters: s.distanceMeters,
        durationSeconds: s.durationSeconds,
      }));
    }
  }
  return gpxList;
}

/** Decodes a base64 TrackLog region dump into one GPX per real DeviceHistory session (see
 * splitIntoActivities()'s own comment) - falls back to the old single-bundled-GPX behavior
 * (decodeTrackLogToGpx()) when there are no sessions to correlate against at all, same real
 * fallback kailash_tracklog.py's own split_into_activities() has. */
export function decodeTrackLogToActivities(b64: string, sessions: KailashSession[]): string[] {
  if (!b64) return [];
  const bytes = base64ToBytes(b64);
  const points = walkRecords(bytes);
  return splitIntoActivities(points, sessions);
}
