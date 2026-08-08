import RNFS from 'react-native-fs';
import { connect, disconnect, addPoi, pickGpxFile, readPoiListRaw, saveToDownloads } from '../native/AmbitUsbModule';
import { parseGpxWaypoints } from './RouteGpxParser';
import { base64ToBytes } from './Base64';

// ─── SBEM0102 POI decoding ─────────────────────────────────────────────────────
// Mirrors ambit-app's tools/ambit_format.py parse_sbem_poi_list(): after the
// fixed 14-byte [u32 0][u8 1][u8 1]["SBEM0102"] prefix, a run of
// [u8 id][u8 len | 0xff + u32 LE len][len bytes]. Entry 0x55 is a POI: three
// NUL-terminated strings (name, route_name, stamp), five u8, then lat/lon as
// i32 LE x 1e7.

const POI_ENTRY_ID = 0x55;

function decodeUtf8(bytes: Uint8Array, start: number, end: number): string {
  let out = '';
  let i = start;
  while (i < end) {
    const b0 = bytes[i];
    if (b0 < 0x80) { out += String.fromCharCode(b0); i += 1; }
    else if ((b0 & 0xe0) === 0xc0 && i + 1 < end) {
      out += String.fromCharCode(((b0 & 0x1f) << 6) | (bytes[i + 1] & 0x3f));
      i += 2;
    } else if ((b0 & 0xf0) === 0xe0 && i + 2 < end) {
      out += String.fromCharCode(((b0 & 0x0f) << 12) | ((bytes[i + 1] & 0x3f) << 6) | (bytes[i + 2] & 0x3f));
      i += 3;
    } else if ((b0 & 0xf8) === 0xf0 && i + 3 < end) {
      const cp = ((b0 & 0x07) << 18) | ((bytes[i + 1] & 0x3f) << 12) | ((bytes[i + 2] & 0x3f) << 6) | (bytes[i + 3] & 0x3f);
      out += String.fromCodePoint(cp);
      i += 4;
    } else { out += '�'; i += 1; } // malformed byte, same spirit as Python's decode(..., "replace")
  }
  return out;
}

interface SbemEntry { id: number; start: number; end: number }

function sbemEntries(bytes: Uint8Array): SbemEntry[] {
  if (bytes.length < 14) return [];
  // bytes[6:14] should read "SBEM0102" — not hard-asserted here, an empty/
  // malformed reply just yields zero entries below (offset walk stops safely).
  const out: SbemEntry[] = [];
  let off = 14;
  while (off + 2 <= bytes.length) {
    const id = bytes[off];
    let len = bytes[off + 1];
    off += 2;
    if (len === 0xff) {
      if (off + 4 > bytes.length) break;
      len = (bytes[off] | (bytes[off + 1] << 8) | (bytes[off + 2] << 16) | (bytes[off + 3] << 24)) >>> 0;
      off += 4;
    }
    const end = off + len;
    if (end > bytes.length) break;
    out.push({ id, start: off, end });
    off = end;
  }
  return out;
}

export interface WatchPoi {
  name: string;
  latitude: number;
  longitude: number;
}

/** Reads and decodes the watch's current POI list. Read-only, no risk to the watch. */
export async function readPoisFromWatch(): Promise<WatchPoi[]> {
  const b64 = await readPoiListRaw();
  if (!b64) return [];
  const bytes = base64ToBytes(b64);
  const pois: WatchPoi[] = [];

  for (const entry of sbemEntries(bytes)) {
    if (entry.id !== POI_ENTRY_ID) continue;
    let p = entry.start;
    const nulAt = (from: number) => {
      let i = from;
      while (i < entry.end && bytes[i] !== 0) i++;
      return i;
    };
    const nameEnd = nulAt(p);
    const name = decodeUtf8(bytes, p, nameEnd);
    p = nameEnd + 1;
    const routeNameEnd = nulAt(p);
    p = routeNameEnd + 1;
    const stampEnd = nulAt(p);
    p = stampEnd + 1;
    p += 5; // route_index, type, sub_type, type_index, flags — not needed for a GPX export
    if (p + 8 > entry.end) continue; // malformed entry, skip rather than throw
    const lat = (new DataView(bytes.buffer, bytes.byteOffset + p, 4)).getInt32(0, true) / 1e7;
    const lon = (new DataView(bytes.buffer, bytes.byteOffset + p + 4, 4)).getInt32(0, true) / 1e7;
    pois.push({ name: name || 'POI', latitude: lat, longitude: lon });
  }
  return pois;
}

function poisToGpx(pois: WatchPoi[]): string {
  const wpts = pois.map(p =>
    `  <wpt lat="${p.latitude.toFixed(7)}" lon="${p.longitude.toFixed(7)}"><name>${escapeXml(p.name)}</name></wpt>`
  ).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<gpx version="1.1" creator="AmbitApp" xmlns="http://www.topografix.com/GPX/1/1">\n` +
    `${wpts}\n</gpx>`;
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export interface ExportPoiState {
  phase: 'idle' | 'connecting' | 'reading' | 'done' | 'error';
  count?: number;
  error?: string;
}

/** Reads every POI off the watch and saves them as a GPX file in Downloads. */
export async function exportPoisToGpx(onState: (s: ExportPoiState) => void): Promise<void> {
  onState({ phase: 'connecting' });
  try {
    await connect();
  } catch (e: any) {
    onState({ phase: 'error', error: e?.message ?? 'Connection to the watch failed' });
    return;
  }

  onState({ phase: 'reading' });
  try {
    const pois = await readPoisFromWatch();
    if (pois.length === 0) throw new Error('The watch has no POIs to export');
    const gpx = poisToGpx(pois);
    const fileName = `pois_${Date.now()}.gpx`;
    const path = `${RNFS.CachesDirectoryPath}/${fileName}`;
    await RNFS.writeFile(path, gpx, 'utf8');
    await saveToDownloads(path, fileName, 'application/gpx+xml');
    onState({ phase: 'done', count: pois.length });
  } catch (e: any) {
    onState({ phase: 'error', error: e?.message ?? 'Failed to export POIs' });
  } finally {
    await disconnect().catch(() => {});
  }
}

export interface AddPoiState {
  phase: 'idle' | 'connecting' | 'writing' | 'done' | 'error';
  error?: string;
}

/**
 * Full pipeline for the Settings "Add POI" form: connect, add, disconnect.
 * Unlike sendRouteToWatch(), this preserves every POI already on the watch
 * and never touches the Waypoints/Routes flash regions — much lower risk.
 */
export async function addPoiToWatch(
  name: string, lat: number, lon: number,
  onState: (s: AddPoiState) => void,
): Promise<void> {
  onState({ phase: 'connecting' });
  try {
    await connect();
  } catch (e: any) {
    onState({ phase: 'error', error: e?.message ?? 'Connection to the watch failed' });
    return;
  }

  onState({ phase: 'writing' });
  try {
    await addPoi(name, lat, lon);
    onState({ phase: 'done' });
  } catch (e: any) {
    onState({ phase: 'error', error: e?.message ?? 'Failed to add the POI' });
  } finally {
    await disconnect().catch(() => {});
  }
}

export interface ImportPoiState {
  phase: 'idle' | 'picking' | 'parsing' | 'connecting' | 'writing' | 'done' | 'error';
  imported?: number;
  total?: number;
  error?: string;
}

/**
 * Picks a GPX, extracts every <wpt> in it, and adds each one to the watch
 * under a single connection (each add already preserves whatever the watch
 * had before it, including the ones just added earlier in this same loop).
 */
export async function importPoisFromGpx(onState: (s: ImportPoiState) => void): Promise<void> {
  onState({ phase: 'picking' });
  let gpxPath: string;
  try {
    gpxPath = await pickGpxFile();
  } catch (e: any) {
    if (e?.code === 'GPX_PICK_CANCELLED') { onState({ phase: 'idle' }); return; }
    onState({ phase: 'error', error: e?.message ?? 'File selection failed' });
    return;
  }

  onState({ phase: 'parsing' });
  let waypoints;
  try {
    const xml = await RNFS.readFile(gpxPath, 'utf8');
    waypoints = parseGpxWaypoints(xml);
    if (waypoints.length === 0) throw new Error('No waypoints (<wpt>) found in this GPX');
  } catch (e: any) {
    onState({ phase: 'error', error: e?.message ?? 'Failed to read the GPX' });
    return;
  }

  onState({ phase: 'connecting', total: waypoints.length, imported: 0 });
  try {
    await connect();
  } catch (e: any) {
    onState({ phase: 'error', error: e?.message ?? 'Connection to the watch failed' });
    return;
  }

  let imported = 0;
  try {
    for (const w of waypoints) {
      onState({ phase: 'writing', total: waypoints.length, imported });
      await addPoi(w.name, w.latitude, w.longitude);
      imported++;
    }
    onState({ phase: 'done', total: waypoints.length, imported });
  } catch (e: any) {
    onState({ phase: 'error', error: e?.message ?? 'Import failed partway through', imported, total: waypoints.length });
  } finally {
    await disconnect().catch(() => {});
  }
}
