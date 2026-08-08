# Route Point Encoding — Current Status & Remaining Unknown

> **Historical, superseded** - the route encoding scale this doc calls unknown was solved in `ROUTE_ENCODING_UPDATE-2026-08-01.md` and is fully documented in `tools/README.md`. Kept for the derivation history only.

## What we know (PROVEN)

**Route simplification (12 stored points from 1066 GPX points):**
- The Ramer-Douglas-Peucker algorithm in `route.js`'s `simplifyRoute()` function reduces GPX routes to maxRoutePoints (1000) for storage.
- In the 12km Gare-du-Nord route: 1066 GPX points → 12 stored records.

**Flash layout (CONFIRMED):**
- Route descriptor @ 0x14c0a0 (52 bytes): name[16] + fields (offset 16-52 unknown)
- Route point body @ 0x14cac8+ (variable, 144 bytes for route12km = 12 records)
- Each record identified by 0x7530 marker at byte offset+8

**Record structure (PARTIALLY DECODED):**
- Most records: 12 bytes
  - Bytes 0-3: int32 (call it `a`)
  - Bytes 4-7: int32 (call it `b`)
  - Bytes 8-9: uint16 marker 0x7530
  - Bytes 10-11: uint16 tail (unknown purpose — running counter? flags?)
- Some records: 8 bytes (marker at end) — likely waypoint markers
- One record: 20 bytes (record 9) — likely waypoint with extra data

**Example from route12km capture (first 3 records, marker-extracted):**
```
Record 0: a=4596,  b=2283,  marker=0x7530, tail=0x0000
Record 1: a=4579,  b=2226,  marker=0x7530, tail=0x3c01
Record 2: a=4580,  b=2216,  marker=0x7530, tail=0x0009
Record 3: corrupted (alignment issue in extraction)
Record 4: a=2057,  b=1629,  marker=0x7530, tail=0x6840
Record 5: a=1956,  b=1612,  marker=0x7530, tail=0x8842
...
Record 9: a=-2593, b=-239,  marker=0x7530, tail=0x84bb (WAYPOINT — 20 bytes total)
Record 10: a=-2628, b=-251, marker=0x7530, tail=0x4fbc
Record 11: a=-2662, b=-274, marker=0x7530, tail=0x1786
```

**Coordinate range analysis:**
- Stored values: -2662 to +4596 (small integers)
- GPX lat: 48.84 to 48.88 degrees
- GPX lon: 2.23 to 2.36 degrees
- All 12 records correspond to the actual GPX simplified points (endpoints + intermediate)

## What remains unknown (THE ENCODING SCALE)

**The missing piece:** How are small integers (4596, 2283, -2593, etc.) transformed into degrees (48.88, 2.356, etc.)?

Tested hypotheses that FAILED:
- Uniform scale (÷100, ÷1000, etc.) does NOT work
- Relative-to-descriptor-base does NOT work
- Delta-encoding (first absolute, rest relative) does NOT parse correctly with any scale

**Likely candidates:**
1. **Meter-based offset from route center** — stored values might be meter offsets (scaled) from a route center, then converted to lat/lon via projection
2. **Transverse Mercator or other projection** — route.js uses `sttalg.js` (navigation/simplification), which might apply a map projection
3. **The descriptor base IS the scale reference** — descriptor @ offset 36-40 has (4603, 2283), which is close to record 0's (4596, 2283), suggesting they're in the same coordinate system but record 0 is an OFFSET from descriptor base
4. **Two-stage encoding** — route.js does coordinate transformation before handing to binary encoder (SDSApplicationServer.exe)

## Next steps to finish this

**Option A (Ghidra static analysis):**
- Open `SDSApplicationServer_exe.c` in a text editor
- Search for `EmuDevice::saveRoutes` or the route serialization function (they're in there, strings confirmed)
- Locate the code that builds the [a,b,marker,tail] records
- The StructMap and scaling function will be right there

**Option B (empirical: SuuntoLink app behavior):**
- Use `route_simplifier.js` to simplify a known GPX
- Instrument `route.js`'s output to see what {Header, Data} object it produces before calling saveRoutes
- Trace what transformation applies in `SDSApplicationServer.exe` to convert {Header, Data} into binary records
- Write that scale in the format decode

**Option C (fixture-based reverse-engineering with the captures):**
- The simplified Gare-du-Nord route should have 12 points that match GPX waypoints at specific indices
- Manually identify which GPX points the 12 stored records represent
- Solve the scaling by least-squares fit to those matched pairs
- This is the most direct path if Ghidra analysis stalls

## Files to support the finish

- **SDSApplicationServer_exe.c** — full decompilation with symbols (1.1M lines)
- **route.js** — desktop route encoder (obfuscated but readable logic)
- **Captures:** route12km, route128km, routesmall (USBPcap)
- **Fixtures:** Gare-du-Nord.gpx (1066 pts), Grand-Tour.gpx (2911 pts)

## Estimated effort to finish

- Ghidra approach: 1-2 hours (locate saveRoutes, read the packing code)
- Empirical fixture approach: 30 min (once you manually identify the 12 matched GPX indices)
- Both together: eliminates guessing, gives ground truth

The scale is THE ONLY remaining blocker for §5.4 (route-point coordinate encoding). Everything else is understood.
