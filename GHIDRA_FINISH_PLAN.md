# Finishing the Route Encoding (§5.4) — Ghidra Plan

## The win you just got

You uploaded the **Windows SuuntoLink** installation files. This gave us:
1. **route.js** — the complete, unobfuscated desktop route encoder (including simplification, relative-distance calc)
2. **SDSApplicationServer.exe** — the native x86 binary that does the final route point serialization
3. **No QEMU needed** — you can analyze x86 code natively on your X230's Windows side or via Ghidra on Linux

The ARM library was a dead-end (symbols weren't helping, structure maps weren't readable statically). The Windows exe is the opposite: x86, symbol-rich (1,648 MSVC C++ symbols), and decompiles cleanly in Ghidra.

## The exact remaining task

**Finish §5.4: decode the coordinate scale** for the 12-byte route point records.

You have:
- The 12 simplified points from route12km capture (stored as int32 pairs: a, b, marker=0x7530, tail)
- The original 1066-point GPX file
- The desktop encoder (route.js) that reduces GPX → simplified points
- The binary encoder (SDSApplicationServer.exe) that converts simplified points → 12-byte records

The ONE unknown: the scale factor that maps stored (4596, 2283, etc.) to degrees (48.88°, 2.356°, etc.).

## In Ghidra (≤2 hours effort)

1. Open `SDSApplicationServer_exe.c` (27 MB, 1.1M lines) in a text editor or search tool
2. Search for **`EmuDevice::saveRoutes`** — this is the Ambit3 route writer
3. In that function, locate the code that:
   - Takes the simplified route data
   - Builds the [int32_a, int32_b, marker=0x7530, tail] records
   - Writes them to flash @ 0x14cac8+
4. Read how `a` and `b` are computed from GPX lat/lon
5. Extract the scale formula (or constants)

The function is in there — we confirmed it with `strings` (logs like "saveRoutes: too many route points"). With symbols, it'll be named.

## Alternative: empirical finish (30 min)

If Ghidra bogs down in the 1.1M line export, do this:

1. **Identify which GPX points the 12 stored records represent:**
   - route.js's `simplifyRoute()` uses Ramer-Douglas-Peucker
   - It always keeps first and last points
   - Middle points are selected based on deviation
   - Manually inspect the 1066-point GPX; mark which 12 points have ~48.88°, ~2.356° and the observed deltas between them

2. **Solve the scale by least-squares fit:**
   - You have 12 (stored_a, stored_b) ↔ (GPX_lat, GPX_lon) pairs
   - Solve: lat = stored_a × scale_lat + offset_lat, lon = stored_b × scale_lon + offset_lon
   - Or: lat ≈ base_lat + (stored_a - base_a) × scale_a if relative to descriptor base (4603, 2283)
   - Python: `numpy.polyfit()` or just least-squares regression

3. **Verify:** plug the scale back into the 12 records, should recover the GPX simplification

## Key file locations

- **Handoff (updated):** `/mnt/user-data/outputs/AMBIT3-SUUNTO-HANDOFF.md` (§5.4 specifics)
- **SDS decompilation:** `/mnt/user-data/outputs/SDSApplicationServer_exe.c`
- **Encoding summary:** `/mnt/user-data/outputs/ROUTE_ENCODING_SUMMARY.md` (all the decoded facts, example records)
- **Captures:** `/mnt/user-data/uploads/route12km`, route128km, routesmall
- **Fixtures:** `/mnt/user-data/uploads/Gare-du-Nord-*.gpx`, Grand-Tour-*.gpx

## Success looks like

Once you find the scale:

1. Write it in the handoff (§5.4) as a concrete formula
2. Implement the decoder in openambit (Deliverable C)
3. Test against the fixtures
4. That closes the last format unknown → Deliverable C route support is ready

Then move to Deliverables A (iOS BLE) and B (Android USB/BLE), which reuse the serializer.

The fact that you went from ARM-lib dead-end to Windows-binary victory in one session is the real win here. The scale is a lookup away.
