// Byte-exact proof for the sport-mode codec, ported from tools/sport_mode_manage.py's own
// --selftest. Replays André's 2026-08-12 SuuntoLink capture
// (assets/pcap/removeandaddsportsmodeandmultisport) - 17 region images, 16 transitions -
// and requires every rebuilt image to match SuuntoLink's own bytes exactly, the same 16/16
// the Python tool passes. The fixture sportmode_capture.json is those 17 region images,
// base64, exported from the pcap with tools/custom_modes_roundtrip.region_images (regenerate
// it from the capture if that ever changes). This is the only honest proof the create/delete
// rules are SuuntoLink's and not ours; it needs no watch and no app build.

import {
  decode, encodeBody, createSportMode, deleteSportMode, createMultisport, deleteMultisport,
  DecodedRegion,
} from '../SportModeCodec';
import capture from './sportmode_capture.json';

// Jest's node environment provides Buffer at runtime; the RN tsconfig has no @types/node, so
// declare just the one method this test uses rather than pulling in all of node's types.
declare const Buffer: { from(data: string, encoding: string): Uint8Array };

const img = (i: number) => new Uint8Array(Buffer.from((capture as Record<string, string>)[String(i)], 'base64'));

type Op =
  | ['create', string, number, number, number, number?]
  | ['delete', string]
  | ['delete-multi', string]
  | ['delete-both', string, string]
  | ['multi', string, number, number[], number];

// Verbatim from sport_mode_manage.py REPLAY. (save 3->4 is two operations in one write:
// André deleted the Triathlon that used Transition, and Transition itself.)
const REPLAY: [number, number, string, Op][] = [
  [0, 1, 'create Alpine skiing 1/3', ['create', 'Alpine skiing', 20, 1786499262, 0]],
  [0, 2, 'create Alpine skiing 2/3', ['create', 'Alpine skiing', 20, 1786499262, 1]],
  [0, 3, 'create Alpine skiing 3/3', ['create', 'Alpine skiing', 20, 1786499262, 2, 1786499267]],
  [3, 4, 'delete Triathlon + Transition', ['delete-both', 'Triathlon', 'Transition']],
  [4, 5, 'create Triathlon', ['multi', 'Triathlon', 19, [1, 2, 4], 1786499373]],
  [5, 6, 'delete Alpine skiing', ['delete', 'Alpine skiing']],
  [6, 7, 'create Multisport', ['multi', 'Multisport', 2, [5, 0, 6, 3, 7, 6], 1786499486]],
  [7, 8, 'delete Multisport', ['delete-multi', 'Multisport']],
  [8, 9, 'delete Triathlon', ['delete-multi', 'Triathlon']],
  [9, 10, 'create Adventure Race', ['multi', 'Adventure Race', 61, [6, 1, 7, 3, 2, 5], 1786499570]],
  [10, 11, 'delete Adventure Race', ['delete-multi', 'Adventure Race']],
  [11, 12, 'create Transition 1/3', ['create', 'Transition', 99, 1786499604, 0]],
  [11, 13, 'create Transition 2/3', ['create', 'Transition', 99, 1786499604, 1]],
  [11, 14, 'create Transition 3/3', ['create', 'Transition', 99, 1786499604, 2, 1786499608]],
  [14, 15, 'create Triathlonwtransitionand6', ['multi', 'Triathlonwtransitionand6', 19, [6, 8, 2, 8, 7, 5], 1786499683]],
  [15, 16, 'delete Triathlonwtransitionand6', ['delete-multi', 'Triathlonwtransitionand6']],
];

function apply(decoded: DecodedRegion, op: Op): DecodedRegion {
  switch (op[0]) {
    case 'create': {
      const [, name, activity, now, step, linkNow] = op;
      return createSportMode(decoded, name, activity, { now, linkNow })[step];
    }
    case 'delete': return deleteSportMode(decoded, op[1]).slice(-1)[0];
    case 'delete-multi': return deleteMultisport(decoded, op[1]).slice(-1)[0];
    case 'delete-both': {
      const after = deleteMultisport(decoded, op[1]).slice(-1)[0];
      return deleteSportMode(after, op[2]).slice(-1)[0];
    }
    case 'multi': {
      const [, name, activity, legs, now] = op;
      return createMultisport(decoded, name, activity, legs, { now }).slice(-1)[0];
    }
  }
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

describe('SportModeCodec', () => {
  test('every capture image re-encodes byte-exact (the safety-rule round-trip)', () => {
    for (let i = 0; i <= 16; i++) {
      const orig = img(i);
      const body = encodeBody(decode(orig));
      expect(bytesEqual(body, orig.subarray(0, body.length))).toBe(true);
      expect(orig.subarray(body.length).every(x => x === 0xff)).toBe(true);
    }
  });

  test.each(REPLAY)('transition %i->%i (%s) reproduces SuuntoLink byte-exact', (before, after, _label, op) => {
    const want = img(after);
    const produced = apply(decode(img(before)), op as Op);
    const got = encodeBody(produced);
    expect(bytesEqual(got, want.subarray(0, got.length))).toBe(true);
    expect(want.subarray(got.length).every(x => x === 0xff)).toBe(true);
  });
});
