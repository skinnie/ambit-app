// Proves the intervals.icu gear IMPORT path parses a real-API-shaped payload correctly
// (fixture mirrors the live GET /gear shape — see docs/reference/intervals-gear-schema.md).
// This is the "get the info from intervals.icu" direction (André 2026-08-18): read-down only.

import { normGear, buildParentMap, isTopLevelType } from '../GearRemoteModel';
import raw from './gear_remote_fixture.json';

const gears = (raw as any[]).map(normGear);
const byId = (id: string) => gears.find(g => g.id === id)!;

describe('gear import (normGear + buildParentMap)', () => {
  test('parses every entry, splitting top gear from components', () => {
    expect(gears).toHaveLength(5);
    const tops = gears.filter(g => !g.component);
    const parts = gears.filter(g => g.component);
    expect(tops.map(g => g.name).sort()).toEqual(['Old Bike', 'Road Bike', 'Trail Shoes']);
    expect(parts.map(g => g.type).sort()).toEqual(['Cassette', 'Chain']);
  });

  test('distance stays in meters; nullable retired becomes false, true stays true', () => {
    expect(byId('1001').distanceM).toBe(12345678);
    expect(byId('1001').retired).toBe(false); // was null
    expect(byId('1002').retired).toBe(true);
  });

  test('type classification (Bike/Shoes are top-level, part types are not)', () => {
    expect(isTopLevelType(byId('1001').type)).toBe(true);  // Bike
    expect(isTopLevelType(byId('1003').type)).toBe(true);  // Shoes
    expect(isTopLevelType(byId('2001').type)).toBe(false); // Chain
  });

  test('parent→child link is recovered from component_ids', () => {
    const parents = buildParentMap(gears);
    expect(parents.get('2001')).toBe('1001'); // Chain -> Road Bike
    expect(parents.get('2002')).toBe('1001'); // Cassette -> Road Bike
    expect(parents.has('1001')).toBe(false);  // a top bike has no parent
  });

  test('reminder parsed with the right unit and server-computed due state', () => {
    const chain = byId('2001');
    expect(chain.reminders).toHaveLength(1);
    const r = chain.reminders[0];
    expect(r.name).toBe('check chain');
    expect(r.distanceM).toBe(500000); // 500 km interval, in meters
    expect(r.timeS).toBe(0);
    expect(r.days).toBe(0);
    expect(r.percentUsed).toBe(100); // >=100 => due, straight from the server
  });
});
