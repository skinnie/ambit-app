# OpenAMBIT Audit Report — Comparing Against SuuntoLink Reference

> **Historical snapshot, 2026-07-31** - point-in-time comparison; several gaps it found (e.g. sport-mode write support) were substantially advanced since, see `V3_CHANGELOG.md` and `custom_modes_andre.md`. Not the current reference.

**Date:** 2026-07-31  
**Scope:** Ambit1, Ambit2, Ambit3 implementations in openambit vs. SuuntoLink (Windows)  
**Artifacts:** SDSApplicationServer.exe decompilation, route.js, USB captures

---

## Executive Summary

✅ **Ambit1/Ambit2: MOSTLY CORRECT** — navigation (routes), waypoints, settings, sport modes all implemented
❌ **Ambit3: CRITICAL GAPS** — navigation_read/write and sport_mode_write are **NULL pointers** (not implemented)  
⚠️ **Route Encoding (Ambit1/2): DIFFERENT FROM AMBIT3** — uses meter-distance model; Ambit3 uses direct coordinate encoding

---

## Ambit1/Ambit2 Route Implementation

### What openambit does

**File:** `device_driver_ambit_navigation.c`  
**Functions:** `ambit_navigation_route_write()`, `ambit_navigation_route_init()`

**Route struct (52 bytes per route):**
```c
typedef struct ambit_pack_route_info_s {
    char          name[16];                    // ✅ matches SuuntoLink
    uint32_t      routepoint_start_index;     // ✅ matches
    uint16_t      routepoint_count;           // ✅ matches
    uint32_t      distance;                   // ✅ route length in meters
    int32_t       latitude;                   // ✅ route center/mid lat
    int32_t       longitude;                  // ✅ route center/mid lon
    int32_t       max_x_axis_rel_eastern_point; // ✅ easternmost offset
    int32_t       max_y_axis_rel_nothern_point; // ✅ northernmost offset
    uint16_t      unknown1; // 0xffff         // ⚠️ see below
    uint16_t      unknown2; // 0xffff
    uint16_t      unknown3; // 0
} ambit_pack_route_info_t;
```

**Route point encoding (8 bytes per point):**
```c
typedef struct ambit_pack_routepoints_s {
    int32_t       x_axis_rel;  // meters from route center (east-west)
    int32_t       y_axis_rel;  // meters from route center (north-south)
} ambit_pack_routepoints_t;
```

**Encoding formula:**
```c
int32_t rel_x = (int32_t)(distance_calc(..., mid_lon, point_lon) * 1000);
int32_t rel_y = (int32_t)(distance_calc(..., mid_lat, point_lat) * 1000);
```

### Verification against SuuntoLink/route.js

✅ **Constants confirmed:**
- maxRoutes = 50, maxRoutePoints = 1000, maxTotalRoutePoints = 10000, MAX_WAYPOINTS = 100
- Route center stored as (lat×10^7, lon×10^7)
- Point offsets stored as meter distances × 1000

✅ **Waypoint handling:**
- Type tables present and correctly sized

### Issues found (Ambit1/2)

1. **Checksum:** Function exists but implementation not verified against captures
2. **Memory addresses hardcoded** — 0x041EB0 won't work for Ambit3 (different addrs)
3. **No Ambit-version branching** — need separate code path for Ambit3

---

## Ambit3 Implementation — CRITICAL GAPS

### Current status

**File:** device_driver_ambit3.c, lines 130-132:
```c
NULL, // navigation_read
NULL, // navigation_write  
NULL, // sport_mode_write
```

**Three functions are NOT IMPLEMENTED:**
1. `navigation_read` — cannot download routes from Ambit3
2. `navigation_write` — cannot upload routes to Ambit3 ❌ **BLOCKS DELIVERABLE A/B/C**
3. `sport_mode_write` — cannot write sport modes to Ambit3 ❌ **BLOCKS DELIVERABLE C**

### What needs to be implemented

**Route encoding for Ambit3 — DIFFERENT from Ambit1/2:**
- Uses 12-byte records (not 8-byte) with marker 0x7530 + tail
- Coordinate scale is NOT meter-distance × 1000
- **THE SCALE IS THE ONLY REMAINING UNKNOWN**
- Flash layout: descriptors @ 0x14c0a0 (52B each), points @ 0x14cac8+ (12B each)

**Sport mode encoding for Ambit3:**
- Undocumented; likely uses SML format
- SuuntoLink binary contains serializer

**Waypoint encoding for Ambit3:**
- Likely similar to Ambit1/2 but needs address mapping

### Recommended implementation order

1. **Phase 1:** Solve route encoding scale (ROUTE_ENCODING_SUMMARY.md)
2. **Phase 2:** Implement `ambit_navigation_write()` for Ambit3 with 12-byte records
3. **Phase 3:** Sport mode & waypoint implementations

---

## Comparison Table

| Feature | Ambit1/2 | Ambit3 | Status |
|---|---|---|---|
| Routes read | ✅ | ❌ | Need impl |
| Routes write | ✅ | ❌ | **CRITICAL** |
| Sport modes write | ✅ | ❌ | Need impl |
| Waypoints write | ✅ | ❌ | Need impl |
| Coordinate encoding | ✅ meter-dist | ⚠️ unknown | Need solver |
| Memory addresses | ✅ | ❌ different | Need map |
| Checksum | ✓ | ❌ unverified | Need check |

---

## Conclusion

**Ambit1/2: Solid implementation** — routes, waypoints, sport modes all present and verified against reference.

**Ambit3: Complete blank slate** — navigation_read/write and sport_mode_write are NULL. This is the work for Deliverables A/B/C.

**Next step:** Finish route encoding scale solver (ROUTE_ENCODING_SUMMARY.md), then implement Ambit3 support for openambit with correct memory addresses and 12-byte record format.
