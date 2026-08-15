import { base64ToBytes } from './Base64';
import { readMemoryMapRaw } from '../native/AmbitUsbModule';
import {
  AMBIT3_WAYPOINT_BASE, AMBIT3_WAYPOINT_REGION_SIZE,
  AMBIT3_ROUTE_BASE, AMBIT3_ROUTE_REGION_SIZE,
} from './RouteReader';

// Per-device navigation port (2026-08-15). The watch declares its own flash layout in the
// 0x0b21 memory-map reply; different products put Waypoints/Routes/CustomModes/Apps at
// different addresses (a Traverse is not an Ambit3 Peak). This decodes that reply so the
// nav readers use the addresses the watch reports instead of the hardcoded Ambit3 bases -
// the same move the desktop makes in tools/write_nav.py read_memory_map().
//
// The reply is a run of "Name\0<hash-hex>\0<u32 start LE><u32 size LE>" entries embedded in
// SBEM0102 framing. We scan for the region names (tolerant of the surrounding framing, just
// like the reference tool's regex), then read the two little-endian u32s that follow the
// hash. This picks up GlonassSGEE / TrackLog too, which the C parser (get_memory_maps) skips.

export interface MemoryRegion {
  base: number;
  size: number;
}

export type MemoryMap = Record<string, MemoryRegion>;

// Region names the watch may declare, mirroring write_nav.py's read_memory_map() scan set
// (plus TrackLog, seen on the Traverse). Order is not significant.
const REGION_NAMES = [
  'Waypoints', 'Routes', 'Rules', 'GpsSGEE', 'GlonassSGEE',
  'CustomModes', 'TrainingProgram', 'ExerciseLog', 'EventLog',
  'BlePairingInfo', 'Apps', 'TrackLog',
];

function bytesEqualAt(hay: Uint8Array, at: number, needle: Uint8Array): boolean {
  if (at + needle.length > hay.length) return false;
  for (let i = 0; i < needle.length; i++) if (hay[at + i] !== needle[i]) return false;
  return true;
}

function asciiBytes(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
}

function readU32LE(b: Uint8Array, off: number): number {
  return (b[off] | (b[off + 1] << 8) | (b[off + 2] << 16) | (b[off + 3] << 24)) >>> 0;
}

/** Parses a raw 0x0b21 memory-map reply (already base64-decoded) into name -> {base,size}. */
export function parseMemoryMap(reply: Uint8Array): MemoryMap {
  const found: MemoryMap = {};
  for (const name of REGION_NAMES) {
    const needle = asciiBytes(name);
    // Scan every occurrence; the entry we want is a name immediately followed by a NUL, so
    // "Routes" never matches inside another token. Same intent as the reference regex's \x00.
    for (let i = 0; i + needle.length < reply.length; i++) {
      if (!bytesEqualAt(reply, i, needle)) continue;
      const afterName = i + needle.length;
      if (reply[afterName] !== 0x00) continue; // must be NUL-terminated to be a real entry
      // name\0 <hash-hex>\0 <u32 start><u32 size> - skip the hash string to its own NUL.
      let cursor = afterName + 1;
      const hashEnd = reply.indexOf(0x00, cursor);
      if (hashEnd < 0 || hashEnd + 1 + 8 > reply.length) break;
      const base = readU32LE(reply, hashEnd + 1);
      const size = readU32LE(reply, hashEnd + 5);
      found[name] = { base, size };
      break;
    }
  }
  return found;
}

/**
 * Reads and parses the connected watch's memory map. Returns {} if the watch does not answer
 * 0x0b21 (or the read fails) - callers fall back to the Ambit3 reference bases via
 * navBasesFrom(), so a watch that predates this command still works exactly as before.
 */
export async function readMemoryMap(): Promise<MemoryMap> {
  try {
    const b64 = await readMemoryMapRaw();
    if (!b64) return {};
    return parseMemoryMap(base64ToBytes(b64));
  } catch {
    return {};
  }
}

export interface NavBases {
  waypointBase: number;
  waypointSize: number;
  routeBase: number;
  routeSize: number;
}

/**
 * The Waypoints/Routes bases+sizes to read, taken from the watch's declared memory map when
 * present, otherwise the Ambit3 Peak reference constants (unchanged pre-port behaviour). The
 * fallback is what makes this safe on any watch that does not declare a region.
 */
export function navBasesFrom(mm: MemoryMap): NavBases {
  const wp = mm.Waypoints;
  const rt = mm.Routes;
  return {
    waypointBase: wp ? wp.base : AMBIT3_WAYPOINT_BASE,
    waypointSize: wp ? wp.size : AMBIT3_WAYPOINT_REGION_SIZE,
    routeBase: rt ? rt.base : AMBIT3_ROUTE_BASE,
    routeSize: rt ? rt.size : AMBIT3_ROUTE_REGION_SIZE,
  };
}

/** Convenience: read the memory map and resolve the nav bases in one call. */
export async function readNavBases(): Promise<NavBases> {
  return navBasesFrom(await readMemoryMap());
}
