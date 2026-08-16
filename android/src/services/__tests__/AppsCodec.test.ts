// Byte-exact proof for the Apps-region codec, against the proven Python
// tools/apps.py + tools/workout_install.py. The fixture apps_fixture.json is generated from a
// real 11-entry Apps dump read off André's watch (backups/Apps_before_walk_install.bin) plus
// build_apps_region() reference outputs - regenerate it with the inline Python if either the
// dump or those tools change. Proves decodeApps + buildAppsRegion + entryChecksum reproduce
// SuuntoLink's own region bytes exactly, no watch/app-build needed.

import { decodeApps, buildAppsRegion, entryChecksum } from '../AppsCodec';
import fx from './apps_fixture.json';

declare const Buffer: { from(data: string, encoding: string): Uint8Array };
const b64 = (s: string) => new Uint8Array(Buffer.from(s, 'base64'));

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

describe('AppsCodec', () => {
  const dump = b64(fx.dumpUsed);
  const existingBlocks = fx.existingBlocks.map(b64);
  const compiled = { binary: b64(fx.compiled.binary), activityId: fx.compiled.activityId, name: fx.compiled.name };

  test('decodeApps reproduces the real region: names, activityIds, markers', () => {
    const entries = decodeApps(dump);
    expect(entries.map(e => e.name)).toEqual(fx.existingNames);
    expect(entries.map(e => e.activityId)).toEqual(fx.existingActivityIds);
    expect(entries.map(e => e.marker)).toEqual(fx.existingMarkers);
  });

  test('every real entry marker matches entryChecksum(binary) (the XOR checksum formula)', () => {
    const entries = decodeApps(dump);
    for (const e of entries) expect(entryChecksum(e.binary)).toBe(e.marker);
  });

  test('buildAppsRegion(existing, app) is byte-exact vs Python build_apps_region', () => {
    const built = buildAppsRegion(existingBlocks, compiled);
    expect(bytesEqual(built, b64(fx.builtAdd))).toBe(true);
  });

  test('buildAppsRegion([], app) onto an empty region is byte-exact vs Python', () => {
    const built = buildAppsRegion([], compiled);
    expect(bytesEqual(built, b64(fx.builtFresh))).toBe(true);
  });

  test('entryChecksum matches the reference marker for the installed app', () => {
    expect(entryChecksum(compiled.binary)).toBe(fx.expectedMarker);
  });

  test('round-trip: the built region decodes back to N+1 entries ending with the new app', () => {
    const built = buildAppsRegion(existingBlocks, compiled);
    const entries = decodeApps(built);
    expect(entries.length).toBe(existingBlocks.length + 1);
    expect(entries[entries.length - 1].name).toBe(compiled.name);
    expect(entries[entries.length - 1].activityId).toBe(compiled.activityId);
  });
});
