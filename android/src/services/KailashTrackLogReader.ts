import { base64ToBytes } from './Base64';

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
  let badStreak = 0;
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

    if (plausible) {
      badStreak = 0;
      points.push({ lat: lat / 1e7, lon: lon / 1e7, year, month, day, hour, minute });
    } else {
      badStreak++;
      if (badStreak > 5) break;
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
function pointsToGpx(points: TrackLogPoint[]): string {
  const first = points[0];
  const metaTime = first
    ? `${first.year}-${pad2(first.month)}-${pad2(first.day)}T${pad2(first.hour)}:${pad2(first.minute)}:00Z`
    : '';
  const trkpts = points.map(p => {
    const t = `${p.year}-${pad2(p.month)}-${pad2(p.day)}T${pad2(p.hour)}:${pad2(p.minute)}:00Z`;
    return `    <trkpt lat="${p.lat.toFixed(7)}" lon="${p.lon.toFixed(7)}"><time>${t}</time></trkpt>`;
  }).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<gpx version="1.1" creator="AmbitApp" xmlns="http://www.topografix.com/GPX/1/1">\n` +
    (metaTime ? `  <metadata><time>${escapeXml(metaTime)}</time></metadata>\n` : '') +
    `  <trk><name>Kailash TrackLog</name><trkseg>\n${trkpts}\n  </trkseg></trk>\n</gpx>\n`;
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
