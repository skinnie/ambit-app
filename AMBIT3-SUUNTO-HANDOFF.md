# Suunto Ambit3 / Traverse — Offline Route & Sync Integration Handoff

A complete, standalone, language-agnostic reference for building **offline GPX-to-watch route
upload** (and a path toward the broader set of features Movescount used to provide) for the
**Suunto Ambit3** family and, with one confirming capture, the **Traverse / Traverse Alpha**.

Three concrete deliverables, plus a forward-looking section for features that existed in the
Movescount era and are now missing:

- **Deliverable A** — a standalone/native app that does **GPX route sync to the Ambit3 over
  BLE**, targeting **iOS** first (iOS has no general USB host access, so BLE is the only path
  there).
- **Deliverable B** — **add GPX route sync to the Ambit3 to opensportsync** (the Android app),
  over **both USB-OTG and BLE**.
- **Deliverable C** — bring **openambit** (desktop, USB/cable) **up to date with full Ambit3
  support**: routes, POIs, and sport modes.

Everything here was reverse-engineered from: raw USB packet captures of SuuntoLink syncing
routes / POIs / deletes to a real Ambit3; the matched source GPX files; the deobfuscated
SuuntoLink JavaScript; the decompiled Movescount Android native library `libkomposti-ng.so`;
the openambit / opensportsync source; the openambit wiki; and Suunto's own documentation. Code
appears only as illustrative pseudocode or as references to real symbols.

> **Trust rule (read this first).** Where this document and a fresh capture or the watch's own
> behaviour disagree, **trust the capture and the watch.** Several details are explicitly
> flagged **UNKNOWN** or **INFERRED** — respect those flags; a wrong body can reboot or wedge
> the watch. There is **no cloud oracle** (Movescount is dead), so the watch itself is the only
> ground truth for correctness.

---

## Table of contents

0. Orientation & the core conclusions
1. Repository & artifact landscape
2. Authentication reality (the "login" question, fully resolved)
3. The route data model & the canonical route-file JSON
4. The transformation pipeline: GPX → simplified route
5. The Ambit3 on-watch flash layout (the target format)
6. The USB transport (HID framing, `0x0b16`, write-head, chunking)
7. The NSP protocol layer (shared by USB and BLE)
8. The BLE transport (GATT, 20-byte framing, session login)
9. The native library map (`libkomposti-ng.so`)
10. Device family & the Traverse question
11. openambit integration points
12. opensportsync integration points
13. Deliverable A — GPX→Ambit3 over BLE (iOS-first)
14. Deliverable B — add route sync (USB-OTG + BLE) to opensportsync
15. Deliverable C — openambit full Ambit3 (routes, POIs, sport modes)
16. Future features (Movescount-era, now missing) — how each maps onto what we know
    (incl. 16.5a — firmware image acquisition / pkgId mechanism)
17. Known unknowns, blockers, and what needs hardware
18. Asset inventory (+ 18.1 captures to collect)
19. Methodology & write-safety discipline
20. Load-bearing constants — quick reference

---

## 0. Orientation & the core conclusions

An Ambit3 route is **not** a GPX. It is a compact binary structure written into specific flash
regions of the watch. The pipeline is:

```
GPX file
  → parse to points + waypoints
  → Douglas–Peucker simplify to ≤1000 points PER ROUTE
  → build the "route-file" model (information file + points file)  [canonical JSON, §3]
  → serialize to the watch's binary flash layout (headers + descriptors + point body)  [§5]
  → write to flash via the 0x0b16 "WriteMemory" command  [§6]
  → over a transport: USB-HID (cable) OR NSP-over-BLE (wireless)  [§7, §8]
```

**Four load-bearing conclusions of the whole study:**

1. **The route write needs no server and no account.** Proven three ways: (a) the native
   route-write function `BluebirdDevice::saveRoutes` has no credential/login/auth check — only
   size guards; (b) gpx2route + openambit already upload routes to Ambit1/2 fully offline, and
   the openambit wiki page is literally *"Adjusting watch settings and routes without
   Movescount"*; (c) openambit's own connect flow does **no login at all** over USB (§2).

2. **The cloud was only ever the content source.** The Movescount account (email + userkey)
   you had to enter into openambit was used **only** for HTTP fetches from the webservice
   (`syncGET /userdevices/<serial>`), never to talk to the watch. Supply route content locally
   (from a GPX) and there is no surviving server dependency.

3. **Over USB there is no device login. Over BLE there is a local session login** (NSP `msgId=1`
   LOGIN, 16-byte token) — local to the watch↔host link, not account-bound (§2, §8). Its exact
   token derivation is the **one remaining BLE-only unknown**, best recovered by sniffing the
   live Suunto app against your own watch.

4. **BLE and USB share everything above the frame layer.** The NSP protocol, the route
   serializer, and the `0x0b16` writes are identical on both; only the outer frame wrapper
   differs (USB HID vs a trivial 20-byte BLE fragmenter). Build the serializer once, reuse it
   for all three deliverables.

**Net feasibility: no cloud blocker remains on either transport.** What is left is
implementation and on-hardware testing, plus finishing two decode details (the Ambit3 relative-
route-point coordinate scale/origin §5.3–§5.4, and the BLE session-login token §8.3 — both are
bounded dynamic-analysis tasks with a designated tool, see Appendix A).

---

## 1. Repository & artifact landscape

| Artifact | Role | Transport | Route support today |
|---|---|---|---|
| **openambit** (openambitproject/openambit) | Desktop C/C++ + Qt; contains `libambit` | USB/HID | **Ambit1/2 yes**, Ambit3 **no** (driver slot NULL) |
| **opensportsync** | Android app (React Native + JNI + native C) | Android USB-OTG (HID) | none for Ambit3 yet |
| **gpx2route** (centic9/gpx2route) | Java CLI: GPX → route-file JSON | n/a (produces files) | Ambit1/2 format |
| `libkomposti-ng.so` | Suunto's own native protocol lib (from the dead Movescount APK) | reference only | the ground-truth implementation |
| openambit wiki | Official offline how-to + route-file JSON schema | — | confirms offline works, gives schemas |
| V2 handoff (`SUUNTO-V2-HANDOFF.md`) | Modern-watch BLE handoff | — | **methodology only** — different BLE generation |

**Shared core.** openambit's `src/libambit/` and opensportsync's
`android/app/src/main/cpp/libambit/` are **byte-identical** for the protocol/parsing files
(`protocol.c`, `libambit.c`, `device_driver_*.c`, `pmem20.c`, `sbem0102.c`, `crc16.c`,
`sha256.c`, `utils.c`, `hidapi/hidapi.h`). They diverge only in the **HID backend**: openambit
has desktop backends; opensportsync has `hid-android.c` (raw fd via `ioctl(USBDEVFS_BULK/
CONTROL)`), `libambit_android.c` (`libambit_new_from_fd`), and `jni_bridge.cpp`. **The Ambit3
route serializer drops into the shared core and is reused by all deliverables.**

---

## 2. Authentication reality (the "login" question, fully resolved)

There are three distinct "keys/logins." Keeping them separate is essential:

1. **Watch hardware serial** — read automatically over USB (openambit just displays it in
   `labelSerial`); never entered by the user. Public.
2. **Movescount account (email + `movescountUserkey`)** — what the user typed into openambit
   (settings field labelled "Email (Movescount account)"). Used **only** for HTTP calls to the
   webservice (`movescount.cpp` `syncGET/syncPUT /userdevices/<serial>`). **This is the dead
   dependency.** It is **not** needed to talk to the watch — the openambit wiki and CLI prove
   full offline operation with no account.
3. **NSP device session login** — a watch↔host handshake inside the protocol (NSP `msgId=1`).

**Over USB: there is NO device login.** openambit's `libambit_new` opens the HID device and
immediately reads/writes — no handshake, no token. The only "lock" (`lock_check`/`lock_set`,
`0x0b19/0x0b1a`) is cosmetic: `libambit_device_driver_lock_log` merely shows a **"Sync"
message on the watch display** during sync. `write_start` (`0x0b1b`) is just a "begin write"
marker. **Nothing authenticates over the cable.**

**Over BLE: there IS a local session login** — NSP `msgId=1`, subId 0. `Task::NSP::Login::
preparePacket` sets the NSP header `dataSize=8` and copies a **16-byte token** into the body;
the watch replies 0 = OK or `DEVICE_RESULT_ERROR_INVALID_LOGIN`. The connect flow is:
`QueryDevice` (msgId=0) → watch returns 0x30 identity bytes incl. serial → derive 16-byte
token → LOGIN. This is **local** (no server) — proven because the current Suunto app still logs
into and syncs an Ambit3 over BLE with Movescount dead.

> **⚠️ UNKNOWN (BLE only):** the exact 16-byte token derivation. Note: `SDS::WB::BypassRouter::
> serialKey` is a **red herring** — it decompiles to the static string `"serial"` (a settings-
> tree key name), not a crypto key. `EndDevice::login(void)` is a base stub returning -1; the
> real path is `NspEndDevice::login(token)` which receives the bytes pre-built from a caller not
> yet pinned in the ptree indirection. **Recommended recovery: HCI-sniff the Suunto app logging
> into your own watch over BLE** — read the serial in the QueryDevice reply and the 16 token
> bytes in the LOGIN body; the transform is `serial → 16 bytes`, verifiable directly. This is
> more reliable than more static analysis. Importance is bounded: USB needs no login at all, so
> offline route write is proven regardless; the BLE token only gates the wireless session.

---

## 3. The route data model & the canonical route-file JSON

### 3.1 `ambit_route_t` (openambit, `src/libambit/libambit.h`)

In-memory structure openambit already populates and passes to `navigation_write`. Transport-
and device-independent.

```c
typedef struct ambit_routepoint_s {
    int32_t  lat;       // degrees × 1e7
    int32_t  lon;       // degrees × 1e7
    int32_t  altitude;  // metres
    uint32_t distance;  // relative distance, 0 .. 1,000,000
} ambit_routepoint_t;

typedef struct ambit_route_s {
    uint32_t id;
    char     name[50];
    uint16_t waypoint_count, activity_id, altitude_asc, altitude_dec, points_count;
    uint32_t distance;
    int32_t  start_lat, start_lon, end_lat, end_lon;
    int32_t  max_lat, min_lat, max_lon, min_lon;
    int32_t  mid_lat, mid_lon;   // BBOX centre (max - (max-min)/2), NOT centroid
    ambit_routepoint_t *points;
} ambit_route_t;
```

### 3.2 Canonical route-file JSON (confirmed from the openambit wiki)

This is the exact format openambit's `openambit-routes` consumes and gpx2route emits. Two files
per route:

**Information file** `routes_<id>_<name>.json`:
```json
{
  "ActivityID": 5, "AscentAltitude": 4865.61, "DescentAltitude": 4865.61,
  "CreatedBy": 8, "Description": null, "Distance": 76659,
  "LastModifiedDate": "2012-10-24T12:42:55.3", "Name": "Granitland",
  "Points": null, "RouteID": 171286, "RoutePointsCount": null,
  "RoutePointsURI": "routes/171286/points", "SelfURI": "routes/171286",
  "StartLatitude": 48.456324, "StartLongitude": 13.992215,
  "Thumbs": 0, "TimesUsed": 0, "UsersCount": 0, "WaypointCount": 0
}
```

**Points file** `routes_<id>_points_<name>.json`:
```json
{
  "CompressedRoutePoints": null, "Points": null,
  "RoutePoints": [
    { "Altitude": 540, "Latitude": 48.456324, "Longitude": 13.992215,
      "Name": null, "RelativeDistance": 0, "Type": null }, ...
  ]
}
```

Plus a `personal_settings.json` listing routes to upload:
`"RouteURIs": "routes/171286,routes/1392640494"`. Then `openambit-routes <dir>` uploads them.

Field mapping (openambit `movescountjson.cpp`): `parseRoute` reads `RouteID`, `Name`
(`strncpy 49`), `WaypointCount`, `ActivityID`, `DescentAltitude`, `AscentAltitude`,
`Distance`, `RoutePointsCount`; `parseRoutePoints` reads each `RoutePoints[]`
(`Latitude/Longitude × 1e7`, `Altitude`, `RelativeDistance × 100000`), injects BEGIN/END
waypoints if none named. **openambit performs no simplification/validation here** — that must
happen upstream (§4).

---

## 4. The transformation pipeline: GPX → simplified route

Recovered from the deobfuscated SuuntoLink JS and **confirmed against matched GPX↔capture
pairs**.

### 4.1 Hard limits (enforce these)

| Constant | Value | Meaning |
|---|---|---|
| `maxRoutePoints` | **1000** | per-route point cap (post-simplification; native guard `>= 0x3e9`) |
| `maxTotalRoutePoints` | **10000** | sum across all routes |
| `maxRoutes` | **50** | routes stored (native guard `> 0x32`) |
| `MAX_WAYPOINTS` | **100** | waypoints (routes + POIs share this budget) |
| `maxNameLength` | **15 bytes** | route/POI name, ISO-8859-15 (NOT 15 chars) |

The bulk region on the watch is the **sum** over all stored routes; each route individually
must be ≤1000 (a capture with 2 routes stored 1188 total points, neither route >1000).

### 4.2 Douglas–Peucker simplification (per route)

Runs after flattening + BEGIN/END tagging, before relative-distance calc.
- If `points ≤ 1000`, unchanged. Else iterate: tolerance starts **2 m**, **doubles** each pass,
  until `≤1000`; ceiling **131072 m** → give up (route rejected, not truncated).
- **Waypoints protected** (never removed; force a segment split).
- Normalized sin² distance; Earth radius **6371160 m** (simplifier) vs **6378100 m**
  (`calculateRelativeDistance`). **2D only** (3D branch never enabled).
- Because tolerance doubles, output counts are input-dependent (verified: 1066→336, i.e. 31.5%
  kept, for the 12 km sample).

### 4.3 Name encoding (`util.js` `convertString`)

Truncate to **15 bytes** in **ISO-8859-15**. Charset stripping is **not** applied on the
route/POI name path (the `strip` flag defaults false). Verified: a descriptor literally begins
with 15-byte `"Gare du Nord to"`.

### 4.4 Waypoints / BEGIN / END

If no named waypoints, inject `BEGIN` ("A") at first point and `END` ("B") at last. Waypoint
type strings map to a numeric enum (0–47).

---

## 5. The Ambit3 on-watch flash layout (the target format)

Reconstructed from the Ambit3 USB captures. Every size relationship verified **exactly** across
all six captures. All multi-byte fields **little-endian**.

### 5.1 Region map

Two parallel structures — **waypoints/POIs** and **routes** — sharing a point body, each with a
fixed header, a 52-byte-per-entry descriptor table, and an index table.

| Address | Size formula | Contents |
|---|---|---|
| `0x005000` | 6 B fixed | Waypoint/POI header. Begins `34 03`; u16 **count** @ +2. |
| `0x005020` | **52 × count** | Waypoint/POI descriptor table |
| `0x16a370` | **4 × count** | Waypoint/POI index |
| `0x14c080` | 32 B fixed | Route header. Begins `0c 34 00 01`; u32 **M** (route count) @ +4; u32 **P** (total points) @ +8; trailing u32 (UNKNOWN). |
| `0x14c0a0` | **52 × M** | Route descriptor table |
| `0x169f88` | **20 × M** | Route index |
| `0x14cac8 …` | **variable** (see §5.3) | Route point body (all routes concatenated) |

The bulk region is a **full-database rewrite on every sync** (byte-additivity across captures:
852+336=1188 points; 10224+4032=14256 B). **Note:** the byte total ≈ 12 × P *on average*, but
the records are **variable-length**, not a flat 12-byte array — see §5.3 (this corrects an earlier
oversimplification).

### 5.2 Route descriptor (52 B, at `0x14c0a0`, one per route)

```
offset 0   : char name[16]     // 15 bytes + NUL, ISO-8859-15  (CONFIRMED)
offset 16… : int32/uint32 fields incl. base coordinate, bbox extents,
             per-route point count, index/offset fields — EXACT layout UNKNOWN (§5.4)
```

### 5.3 Route point body — VARIABLE-LENGTH records (at `0x14cac8+`)

**Corrected finding (decoded from the `route12km` fixture, 336 points).** The point body is
**not** a flat 12-byte array — that was an earlier oversimplification that happened to match the
*byte total* but hid the real grammar. The records are **variable-length**:

- In the 336-point sample: **252 records are 12 bytes, 72 records are 14 bytes.**
- Every record carries a constant tag **`0x7530` (=30000)** at a fixed internal offset (offset 8
  in the 12-byte form). This is a reliable record-marker for re-alignment.
- **12-byte record** parses as:
  ```
  offset 0 : int32  fieldA   (small, ~4600 in the sample; relative coordinate component)
  offset 4 : int32  fieldB   (small, trends along route; relative coordinate component)
  offset 8 : uint16 0x7530   (constant tag = 30000)
  offset 10: uint16 tail     (running counter / relative-distance-like, increments along route)
  ```
- **14-byte record** = the same head + `0x7530`, but a **4-byte tail** instead of 2 (i.e. 2 extra
  bytes). 72 of these appear in a route that has named waypoints, so the **strong hypothesis** is
  that the extra field marks **waypoints** (BEGIN/END + intermediate named points inject extra
  per-point data). Confirm the exact flag when finishing (§5.4).

Coordinates are **relative** (small offsets from a per-route base held in the descriptor), not
absolute lat/lon×1e7.

### 5.4 ⚠️ UNKNOWN — coordinate scale/origin + record-type flag (a DYNAMIC-analysis task)

**Known (confirmed):** variable-length 12/14-byte records; `0x7530` tag; the field split above;
relative encoding; 14-byte records ≈ waypoints.

**Not yet pinned:** the exact scale factor and base origin mapping `fieldA/fieldB` → lat/lon, and
the precise flag distinguishing 12- vs 14-byte records. **Why captures alone stall here:** once a
14-byte (waypoint) record appears, naive fixed-stride re-alignment drifts, so each stored record
can't be cleanly mapped back to its source GPX point to solve for the transform. The authoritative
answer is the **StructMap** at `DAT_00d2c458` (a `{ field-name → byte-offset → type → unit }`
table consumed by `Communist::Serialization::TreeToStruct`) — but its pointers are **filled in at
load time by the dynamic linker**, so they read as **zero in the static file**. Static parsing
therefore returns nothing; this is a genuine static-analysis boundary.

**Finish it dynamically (this is the designated X230 task — see Appendix A):**
1. Run the 32-bit ARM library under `qemu-arm` on the x86 Linux box (Apple Silicon can't execute
   32-bit ARM; the X230 can).
2. Either **(a)** dump `DAT_00d2c458` from the **relocated process memory** (pointers now valid →
   read the field grammar: names, offsets, types, units, and the 12-vs-14 record rule directly),
   or **(b)** call the routepoint serializer (`BluebirdDevice::saveRoutes` / the Emu route path
   via `TreeToStruct`) with a hand-made 2–3-point route (one plain point, one waypoint) and read
   the exact emitted bytes.
3. **Verify** the recovered transform against the matched GPX↔capture fixtures (`route12km` +
   `Gare-du-Nord.gpx`, `route128km` + `Grand-Tour.gpx`) until you can regenerate the captured
   bytes exactly.

This is a bounded decode with ground-truth fixtures and a clear tool — not open-ended research.

### 5.5 Delete semantics

Delete **resets the nav database**: writes the two fixed headers with **zeroed counters**,
issues `nav_memory_delete` (`0x0b04`), omits all bulk writes. Zeroes **both** POI and route
headers (shared quota).

### 5.6 POIs vs routes

POIs share the database and the 52-byte descriptor size, but POI **content** travels via a
`0x0b25` **SBEM0102** message (readable POI name inside), not the `0x0b16` flash writes used for
route geometry. The current Suunto app's POI-over-cable path still works (recent capture) — a
**live oracle** for the SBEM navigation-write choreography if needed.

---

## 6. The USB transport (HID framing)

Shared, already implemented in `protocol.c`, unchanged for Ambit3.
- **HID packet header:** each 64-byte report starts `0x3f`; first packet `MP=0x5d` (≤42 payload
  bytes), continuations `MP=0x5e` (54 bytes); CRC-framed by `finalize_packet`.
- **`0x0b16` write payload** = 8-byte write-head `[u32 addr][u16 pack_len][u16 pack_seq]`
  (`ambit_pack_write_head_t`) + ≤**1024** payload bytes; address stride **0x400**; `pack_seq`
  written as **0**.
- Sequence: `0x0b1b` write_start (where used) · `0x0b04` nav_memory_delete · `0x0b16` writes ·
  `0x0b18` data_tail_len · `0x0b25`/`0x1201` close.

The Ambit3 route write **reuses this mechanism** — only the addresses and payload layout differ
from Ambit2. openambit's `ambit_navigation_route_write_to_packs` is a ready-made chunking
primitive.

---

## 7. The NSP protocol layer (shared by USB and BLE)

Above the frame layer sits **NSP** — the request/response protocol. **Transport-independent**:
identical bytes over USB (`UsbFrameProtocol`) and BLE (`BleFrameProtocol`).

### 7.1 NSP header — 12 bytes, little-endian

```
0  u8   msgId       (0=QUERY, 1=LOGIN, 2=SYSTEM, …)
1  u8   subId
2  u8   flags        (0x01 PC, 0x02 DEVICE, 0x04 REQUIRE_ACK, 0x08 ACK,
                       0x10 ENCRYPTED, 0x20 DATA_CONTINUE)
3  u8   errorFlags   (0x01 FAILED, 0x02 NOT_SUPPORTED, 0x04 RETRY)
4  u16  connectionId (echoed; established at login)
6  u16  packetNumber (auto-increments)
8  u32  dataSize     (body length; MUST be < 0x415 = 1045)
```
Body of `dataSize` bytes follows. **No CRC at the NSP layer.** Host sets the **PC** flag; the
route/settings path does not set ENCRYPTED.

### 7.2 Receiver boundary rule

Read exactly 12 header bytes, then `dataSize` body bytes, then dispatch. **Message length is in
the header, not any delimiter** — which is why the BLE frame layer can be a dumb byte-chunker.

### 7.3 WriteMemory = the `0x0b16` mechanism

`Task::NSP::WriteMemory(msgId=0x0b, addr, srcbuf, len)` carries flash writes. In
`BluebirdDevice::saveRoutes` (Ambit1/2) it targets `0x41EB0` (270000) and `0x42830` — **exactly
openambit's Ambit2 constants**, independently confirming the capture-derived model. Ambit3
writes the §5.1 addresses via the same task. Related: `ReadMemory` (id 4 flash / 5 RAM).

---

## 8. The BLE transport

### 8.1 GATT service and characteristics (Ambit3 "NSP" service)

| Role | UUID |
|---|---|
| Service | `98ae7120-e62e-11e3-badd-0002a5d5c51b` |
| Write (phone→watch, "toServer") | `c6339440-e62e-11e3-a5b3-0002a5d5c51b` |
| Notify (watch→phone, "toClient") | `d0fd6b80-e62e-11e3-a2e9-0002a5d5c51b` |
| CCCD | `00002902-0000-1000-8000-00805f9b34fb` |

Suunto BLE company id (advertisement) is `0x009F`. These UUIDs are **different** from the modern
Movesense/Whiteboard ones in the V2 handoff — use these.

### 8.2 The BLE frame layer is trivial

`BleFrameProtocol::transmitPacket` splits the `[NSP header][body]` stream into fixed **20-byte**
(`0x14`) pieces and writes each to the write characteristic. **No delimiter, escape, checksum,
or header.** `receivePacket` just forwards. So:
```
send(nsp_bytes):  for off in range(0, len, 20): gatt_write_no_response(WRITE, nsp_bytes[off:off+20])
receive:          concat notifications from NOTIFY, split by NSP boundary rule (§7.2)
```
That is the entire BLE-specific transport; everything above is NSP (§7), identical to USB.

### 8.3 The session login

Connect → enable notify → LE-bond → NSP `QueryDevice` (reads serial) → derive 16-byte token →
NSP `LOGIN` (dataSize=8, body=16 token bytes) → session open (`connectionId` valid) → free to
WriteMemory. Login is **local** (§2). `IsAlive` (msgId 1 subId 2) keeps it warm; `Logout`
(msgId 1 subId 1). **⚠️ token derivation UNKNOWN — recover via HCI sniff (§2).**

---

## 9. The native library map (`libkomposti-ng.so`)

32-bit ARM, **not stripped**; C++ names demangle. Built GCC 4.9 / Android clang 3.8, 2015.
Structure: **one NSP protocol, three interchangeable frame wrappers** (`NSP` over `BleFrame` /
`UsbFrame` / `SerialFrame`, declared in embedded XML).

Key symbols:
- `Communist::NspProtocol::{transmitPacket,receivePacket,resetReceive}` — NSP framing (§7).
- `Communist::BleFrameProtocol::{transmitPacket,receivePacket}` + ctor(20) — BLE frames (§8).
- `Communist::UsbFrameProtocol` — USB frame sibling.
- `BluebirdDevice::saveRoutes` (Ambit1/2 serializer, → openambit); `saveRoutesWithAltiGraph
  RoutePoints`, `saveBinRoutes`, `getRouteStoreSize`, `clearRoutes`.
- `EmuDevice::*` — the **Ambit3** device class (route path to confirm; §7.3 note).
- `Task::NSP::{WriteMemory, ReadMemory, Login, Logout, IsAlive, QueryDevice}`.
- `Communist::Serialization::TreeToStruct` — property-tree → packed struct (needed for §5.4).
- `Communist::Bluebird::WaypointMapping::mapWaypointTypeToBluebird` — waypoint enum.
- `EmuDevice::{loadMCCredentials, saveMCCredentials, updateSgeeFile, getSmlBinaryAreas}` — POI/
  SGEE/settings paths (relevant to Deliverable C & future features).

JNI surface (`SuuntoDeviceServiceWrapper`): `syncDeviceSettings`, `setSmlData`, `syncDeviceImpl`,
`getLogBook`, etc. Routes ride inside the **device settings sync** gated by `getRoutesChanged()`.
(Reference only — you re-implement the wire output, not call this lib.)

**Variant codenames** (match openambit `device_support.c`):

| Codename | Model | | Codename | Model |
|---|---|---|---|---|
| Bluebird | Ambit | | Emu | Ambit3 Peak |
| Duck | Ambit2 | | Ibisbill | Ambit3 R |
| Greentit | Ambit2 R | | Finch | Ambit3 S |
| Colibri | Ambit2 S | | Kaka | Ambit3 V |
| | | | Jabiru | Traverse |
| | | | Loon | Traverse Alpha |

---

## 10. Device family & the Traverse question

**Full codename table** (product ↔ internal name ↔ USB identity, from SuuntoLink 4.1.15's
`Devices.xml`; codenames independently cross-confirmed by decompiling `libkomposti-ng.so`):

| Product | Internal codename | USB VID:PID |
|---|---|---|
| Ambit | `Bluebird` | 1493:0011 |
| Ambit2 | `Duck` | 1493:0019 |
| Ambit2 S | `Colibri` | 1493:001a |
| Ambit2 R | `Greentit` | 1493:001d |
| Ambit3 Peak | `Emu` | 1493:001b |
| Ambit3 Sport | `Finch` | 1493:001c |
| Ambit3 Run | `Ibisbill` | 1493:001e |
| Ambit3 Vertical | `Kaka` | 1493:002c |
| Traverse | `Jabiru` | 1493:002b |
| Traverse Alpha | `Loon` | 1493:002d |
| Kailash | `Hoopoe` | 1493:002a |

BSL (bootloader-mode) entries exist for each — e.g. `Suunto Ambit3 BSL` type `Emu` — same VID,
distinct PID; this is the recovery-mode identity if a firmware write fails (§16.5).

Traverse (`Jabiru`) and Traverse Alpha (`Loon`) are the **same generation and stack** as the
Ambit3 — same Movescount app, same NSP/WriteMemory transport, same BLE "NSP" service (the
UUIDs are family-wide, not per-model), and openambit already has `device_support.c` entries for
them. **The entire transport layer (USB HID, `0x0b16`, NSP header, BLE 20-byte frames, local
login) transfers unchanged.**

**What must be confirmed per model:** the **flash-layout addresses and the route/descriptor/
point format** were derived from Ambit3 captures; a Traverse memory map may differ. **One
SuuntoLink route-sync capture of a Traverse (cable, offline) resolves it** — same analysis
technique as this study. Treat Traverse/Traverse Alpha as "Ambit3 support + one confirming
capture."

---

## 11. openambit integration points

### 11.1 The exact gap

`src/libambit/device_driver_ambit3.c` vtable has `NULL, // navigation_read` and
`NULL, // navigation_write`. The dispatcher `libambit_navigation_write()` already follows the
pointer; the slot being non-NULL turns on Ambit3 routes.

### 11.2 Reusable (do NOT rewrite)

- Population: `movescountjson.cpp` (`parseRoute`/`parseRoutePoints`/`appendRoutePoint`).
- Callers: `openambit`, `openambit-cli`, `openambit-routes` (the latter reads the route-file
  JSON from a local dir with `movescount==NULL` — the offline path).
- Transport: `protocol.c`, `0x0b16`, `ambit_pack_write_head_t`, and
  `ambit_navigation_route_write_to_packs` (chunking primitive — parameterize its addresses).
- **No login to implement over USB (§2).**

### 11.3 New for Ambit3

- Ambit3 navigation write wired into the vtable (new `device_driver_ambit3_navigation.c`).
- The Ambit3 flash serializer (§5): headers, 52-B descriptors, indexes, 12-B relative points.
- The relative-coordinate transform (§5.3/§5.4) — recover dynamically first (Appendix A).
- Simplification + validation (§4) — openambit lacks it.
- (Optional) `navigation_read` for waypoint reconciliation.

### 11.4 Sport modes & POIs offline (already partly solved by the wiki)

`openambit-cli --write-config-json` fetches `settings.json` + `apprules.json` **from the watch**;
edit `CustomModeGroups`/`CustomModes` locally; write back with `--custom-config`/`--app-config`.
This is **already offline** (no cloud). What's missing is convenience (no GUI, no list of visual
IDs). POIs live in `settings.json` too. So Deliverable C's sport-mode/POI work is largely
**tooling/UX over an already-working offline path**, not new protocol.

---

## 12. opensportsync integration points

Existing: Android USB-OTG (`AmbitUsbModule.kt` → `jni_bridge.cpp` →
`libambit_new_from_fd` → `hid-android.c`), the shared libambit core, and a `DeviceConnector` TS
interface explicitly designed for additional transports.

New for routes: the Ambit3 serializer (from Deliverable C / shared core) is already present;
wire it to the existing USB path. New for BLE: a BLE transport (Android `BluetoothGatt`,
mirroring `BLECentralImpl`) + the 20-byte frame + NSP layer + session login, feeding the same
serializer.

**Structure it like `libkomposti`: one NSP/route layer, two frame implementations (USB-HID,
BLE).**

---

## 13. Deliverable A — GPX→Ambit3 over BLE (iOS-first)

**Why iOS = BLE only:** iOS gives apps no general USB-host access (no `UsbManager` equivalent);
a shipping iPhone app cannot do Ambit3 HID cable sync. BLE is the path. (iPadOS has narrow USB
latitude via External Accessory/DriverKit but nothing practical for Ambit3 HID.)

Task order:
1. **CoreBluetooth bring-up** — scan (Suunto company id `0x009F`; NSP service may be
   unadvertised), connect, discover the §8.1 service + write/notify chars, enable notifications,
   LE-bond. iOS pairing wrinkles (from V2 handoff, applicable): persist the peripheral
   identifier and reconnect by known identifier; a stale bond → forget + re-pair.
2. **Frame + NSP layer** — 20-byte fragmenter (§8.2) + NSP header build/parse (§7). Round-trip a
   QUERY.
3. **Session login (§8.3)** — QueryDevice → derive token → LOGIN. **Recover the token transform
   by HCI-sniffing the Suunto app first (§2).** This is the critical path for iOS.
4. **Route serializer** — reuse the Ambit3 serializer (§5); send via WriteMemory over BLE.
5. **On-hardware test** — route appears and navigates, wirelessly, offline.

Language note: the serializer and NSP logic are language-agnostic; port to Swift or compile the
C core for iOS. Reuse the C `libambit` route serializer if feasible to avoid a second
implementation.

---

## 14. Deliverable B — add route sync (USB-OTG + BLE) to opensportsync

1. **USB-OTG routes** — the easy, proven path: feed the Ambit3 serializer through the existing
   `AmbitUsbModule`/`hid-android.c` chain. No login needed (§2). Ship this first.
2. **BLE transport** — Android `BluetoothGatt` against §8.1; 20-byte frames + NSP + session
   login (§7, §8); same serializer.
3. **Unify** under one `DeviceConnector` with USB and BLE implementations.

Build Deliverable C (or at least its serializer) first so the route format is proven over the
easiest-to-debug transport before adding BLE.

---

## 15. Deliverable C — openambit full Ambit3 (routes, POIs, sport modes)

1. **Routes** — §11.1–11.3. Land the delete/reset path first (needs no point-format knowledge,
   byte-identical across two captures — safest first hardware test), then the full serializer.
2. **POIs** — write via the `0x0b25`/SBEM0102 path (§5.6); content lives in `settings.json`.
3. **Sport modes** — mostly **tooling** over the already-offline `--write-config-json` round-trip
   (§11.4): fetch from watch, edit `CustomModes` locally, write back. A GUI/editor + a map of
   visual IDs is the real deliverable, not new protocol.

**Definition of done (all deliverables):** local GPX (and locally-authored POIs/sport modes) →
watch shows/uses them, fully offline, no server.

---

## 16. Future features (Movescount-era, now missing) — mapping onto what we know

These were requested for eventual integration. Each is scoped against current knowledge so the
architecture stays open to them.

### 16.1 Build complex workouts with a GUI
The Ambit "sport modes / custom modes / rules" system is the vehicle. Content lives in
`settings.json` + `apprules.json` (fetched offline via `--write-config-json`), as
`CustomModeGroups`, `CustomModes`, and compiled `Rules` (there's an on-device VM;
`TargetVirtualMachineVersion`, `Binary` base64 in the SML schema). **Feasibility:** the
transport and the offline round-trip already exist; the work is (a) a GUI to author modes/
displays and (b) recovering the **visual/display ID catalogue** (the wiki explicitly notes
there is no public list — this needs enumeration by trial or by mining `libkomposti`'s Bluebird/
Emu CustomMode converters, e.g. `BluebirdCustomModeConverter`). **New work: display-ID map + GUI;
no new transport.**

### 16.2 Upload a training plan / workout
Movescount pushed **training programs** to the watch. In `libkomposti`,
`EmuDevice::handleMCServiceTrainingPrograms` and a `training_program` memory-map entry exist
(seen in `device_driver_ambit3.c`'s memory-map struct). **Feasibility:** the write mechanism is
the same NSP/memory-write family; the unknown is the **training-program binary format**, which
would need its own capture (sync a training program from the app, if any path still exists) or a
decode of the EmuDevice training path. **New work: format RE; transport already known.**

### 16.3 3rd-party activity sync (Strava, intervals.icu)
This is **downstream of the phone/desktop, not the watch** — read activities off the watch (a
solved-ish direction: openambit already downloads logs; the V2 handoff documents the
watch→phone activity pull for modern watches), convert to FIT/GPX/TCX, and POST to the service's
API (Strava OAuth, intervals.icu API key). openambit even ships a `stravauploader` tool already.
**Feasibility: high, and independent of the route work** — it's normal REST integration once you
have the activity file. **New work: FIT/TCX export + each service's API client.**

### 16.4 Gather orbital data, routes, and POIs from the Suunto app
The **content-source** replacement problem. Three sub-cases:
- **GNSS orbital (SGEE/AGPS):** generic assistance data, **not** account-bound.
  `EmuDevice::updateSgeeFile` writes it; the modern AGPS host is
  `devices.suunto-operations.com` (per the V2 handoff). **Feasibility: promising** — a live
  (non-Movescount) source may be reachable; the watch-write path (`updateSgeeFile`) is known.
  This is the most tractable "content" feature.
- **Routes:** already solved — generate from GPX locally (this whole document).
- **POIs:** author locally (they live in `settings.json`; write via `0x0b25`/SBEM0102).
"Gather from the Suunto app" specifically (scraping the app's local store or its cloud) is a
separate, fragile path; prefer local authoring + a live AGPS source over depending on the app.

### 16.5 Firmware update over USB
Flash a Suunto firmware image to the watch from openambit, without SuuntoLink — useful for
preservation (installing an archived firmware) or recovery.
- **Transport is already understood.** The FW-update path exists in the stack we mapped:
  `SyncServiceImplementation::firmwareUpdate` in `libkomposti`, and the NSP **SYSTEM** message
  class (msgId 2) with `UPDATE_MODE` / `START_APP` / `RESET` subids drives the bootloader. The
  image is streamed to the watch via the same memory-write / bootloader-mode mechanism.
- **You do NOT need to decrypt the firmware to install it.** The image (`SFI2` container) is
  handed to the watch's bootloader **as-is**; the bootloader decrypts on-device with its own key.
  So a "relay this `.SFI2` blob to the bootloader over USB" feature is feasible from the encrypted
  file alone — this is exactly what SuuntoLink does. (We have a sample image, `Emu-fw_2.4.17`, in
  the asset inventory.)
- **Feasibility: moderate, but HIGH RISK.** The transport is known and the payload needs no
  decryption, so it's buildable. But a botched firmware write can **brick the watch** (far worse
  than a bad route, which at most reboots it). This must be gated behind explicit confirmation,
  validated against a captured SuuntoLink firmware-update session first (capture one, diff your
  byte stream against it), and ideally tested only when a recovery/BSL path is understood. The
  device XML lists `*BSL` (bootloader) entries (e.g. `Suunto Ambit3 BSL`, `type="Emu"`) — the
  bootloader-mode identity — which is the recovery handle if an update fails.
- **New work:** capture a SuuntoLink FW-update session (the one missing artifact); map the
  `UPDATE_MODE` → stream → verify → reset choreography; implement the relay with hard safety gates.
  **Do this LAST** of all features — it's the highest-consequence write in the whole project.

### 16.5a Firmware image acquisition (the content-source half of §16.5)

§16.5 covers *installing* a firmware image already in hand. This covers *obtaining* one for a
codename/version you don't already have a sample of — the firmware equivalent of the AGPS/route/
POI content-source problem in §16.4.

**Filename mechanism, fully traced (SuuntoLink `SDSApplicationServer.exe`, cross-confirmed against
`libkomposti-ng.so`'s NSP layer):**

```
GET/build:  https://firmware.geo.movescount.com/production/<Codename>-fw_<swVersion>-<pkgId>.zip
```

- `<Codename>` — from the family table (§20).
- `<swVersion>` — the human-readable version from Suunto's own changelog pages
  (`suunto.com/.../Software-updates-for-Suunto-products/...`); public, no device needed.
- `<pkgId>` (e.g. `70.2.17414`) — **read from the watch itself**, not hardcoded, not derivable
  offline. `SDSApplicationServer.exe`'s `taskQueryDevice` issues an NSP `msgId=0 QUERY` (the same
  message class as this doc's §20 NSP header table) and the watch answers with `hw version
  <pkgId>` alongside `sw version` and `bsl version` — visible verbatim in `suuntoapp.log`/
  `sds.log` (`SDS/ConnectedDevices` payload: `{"variant":"Emu","hw":"70.2.17414",...}`). The
  client then sends `{model, hw, sw}` to the backend, which echoes `hw` back inside
  `hardware.firmware.uri` — the full download URL. **No static resource anywhere in the client
  contains a codename→pkgId table**; it is manufactured per-session from live device state.

**`pkgId` structure — working theory, not proven:** appears to be `<namespace>.<sub>.<serial>`.
The namespace segment tracks *backend generation*, not hardware or content — confirmed by three
historical values for the Ambit3 Peak line: `69.2.17410` → `69.4.17414` → `70.2.17414`. The
trailing serial (`17414`) survived the `69.4`→`70.2` jump unchanged, while the namespace pair
didn't — consistent with Suunto renumbering the catalog namespace at the Movescount→
`devices.suunto-operations.com` migration (Movescount ended Ambit/Traverse sync Feb 9 2021) while
the underlying release package stayed the same. The serial also appears to be **shared per joint
release, not per model**: `Emu` and `Ibisbill` (Ambit3 Peak/Run) both resolve under `70.2.17414`
at `sw 2.4.17`, matching Suunto's own changelog, which has always bundled Peak/Sport/Run as one
simultaneous release. `Kaka` (Ambit3 Vertical) runs a wholly separate SW version line (`1.1.22`
vs `2.4.17`) and never appears in a joint Peak/Sport/Run announcement, so it almost certainly has
its own `pkgId`, not `70.2.17414`.

**Endpoints:**
- CDN (stable across backend generations, still live 2026): `firmware.geo.movescount.com` — this
  host survived the Movescount shutdown even though the lookup API didn't.
- Legacy REST lookup (Movescount era, **dead** — host likely fully retired):
  `GET https://uiservices.movescount.com/devices/<Codename>/<pkgId>/<swVersion>/binary?appkey=<key>`
  (confirmed working as of a 2020 Suunto forum post; app key
  `<APPKEY>` — identical key hardcoded in
  both SuuntoLink 4.1.15's `production.json` and openambit's `mainwindow.cpp`/`Task.cpp`, so it's
  a shared/static app credential, not per-install).
- Current REST lookup: `serverUrl` in SuuntoLink 4.1.15's `production.json` is
  `https://devices.suunto-operations.com`; exact path **not yet captured** (TODO — same capture
  that gets §16.5's FW-update session would likely also expose this).

**Known `pkgId` values (everything recovered so far, all via device capture or direct CDN probe —
no static/published source exists for any of these):**

| Codename(s) | swVersion | pkgId | Source |
|---|---|---|---|
| Emu, Ibisbill (Ambit3 Peak/Run) | 2.4.17 | `70.2.17414` | Confirmed downloadable (direct CDN probe) |
| Finch (Ambit3 Sport) | 2.4.17 | `70.2.17414` (predicted) | Untested — same joint release as above |
| Hoopoe (Kailash) | 2.0.5 | `72.1.0` | Live SuuntoLink `suuntoapp.log` capture |
| Emu (older) | 2.4.17 | `69.4.17414` | 2020 forum post (Movescount-era, now dead) |
| Emu (older still) | unknown | `69.2.17410` | Community reference (Movescount-era, now dead) |
| Kaka, Bluebird, Duck, Colibri, Greentit, Jabiru, Loon | various | UNKNOWN | Confirmed NOT `70.2.17414` for the Ambit1/2 family (tested); no other candidates tried yet |

**Recovery methods for the remaining unknowns, in order of cost:**
1. Capture `suuntoapp.log`/`sds.log` from a real device connected to SuuntoLink (proven twice:
   Emu, Hoopoe) — the only method that has never failed.
2. Brute-force the CDN path using the namespace/serial theory above (fix `70.2`, sweep nearby
   serials) rather than guessing a full unconstrained triplet.
3. Query `devices.suunto-operations.com` with just `{model}` and no `hw`, to see if the API
   reveals or defaults to the current `pkgId` in an error/response body — untested.
4. Wayback Machine CDX query against `uiservices.movescount.com/devices/*` pre-Feb-2021 —
   untested; needs a live browser (`web.archive.org/cdx/search/cdx?url=...`), not reachable from
   an automated fetch-only tool.

**Architectural guidance for openness:** keep a clean split between **content producers** (GPX→
route, GUI→sport mode, AGPS fetcher, workout authoring) and the **watch-write core** (NSP +
serializers + transports). Every future feature above is a new *content producer* feeding the
same core. Structure all three deliverables so the core is a reusable library with a stable
"write this typed object to the watch" interface.

---

## 17. Known unknowns, blockers, and what needs hardware

**Format unknowns (decodable, have fixtures):**
- ⚠️ **The route-point coordinate encoding** (§5.3/§5.4) — main format task. Structure is now
  known (variable 12/14-byte records, `0x7530` tag, relative coords, 14-byte≈waypoint); what
  remains is the scale/origin + record-type flag, which is a **dynamic** task: QEMU the relocated
  `StructMap`/serializer on the X230 (Appendix A) and verify against the fixtures.
- The 52-byte descriptor's non-name fields (§5.2); the route header trailing u32; index tables.

**Transport unknowns (traceable / sniffable):**
- ⚠️ **BLE session-login 16-byte token derivation** (§8.3) — recover by HCI-sniffing the live
  Suunto app against your own watch. USB needs no login, so this gates only the wireless path.
- Confirm the Ambit3 route path in `EmuDevice` (WriteMemory-with-new-addresses vs SML) — the
  captures are authoritative for the wire regardless.

**Future-feature unknowns:** sport-mode **display-ID catalogue** (§16.1); **training-program
binary format** (§16.2); a **live AGPS source** (§16.4); a captured **SuuntoLink firmware-update
session** + the Ambit3 firmware **AES key** if full-image analysis is ever wanted (§16.5 — note
the relay feature needs neither the key nor the capture to *install*, only to be *validated*).

**Hard requirement — no oracle:** Movescount is dead; correctness is only confirmable on a real
Ambit3. Budget for iterative on-hardware testing. The current **Suunto app** (still syncs over
BLE, still pushes POIs over cable) is the closest live reference and is HCI-sniffable on your own
device.

**Not blockers (resolved):** cloud/account dependency (none on the write path, §2); BLE
feasibility (frame layer trivial, login local); route format at region level (fully mapped);
simplification (fully recovered); transport framing (fully mapped); **USB device login (there is
none)**.

---

## 18. Asset inventory

| Asset | What it is | Use for |
|---|---|---|
| `routesmall`, `route12km`, `route128km`, `sync` | Ambit3 route-sync USB captures | ground-truth flash layout & wire format |
| `routedelete` | Ambit3 route/nav delete capture | delete/reset sequence (§5.5) |
| `poiimport` | Ambit3 POI import capture (recent, Suunto app + cable) | POI mechanism; live-path reference |
| `Gare-du-Nord-…gpx` (1066 rtept) | **source GPX** for `route12km` | matched input↔output fixture |
| `Grand-Tour-HDF-…gpx` (2911 rtept) | **source GPX** for `route128km` | matched input↔output fixture |
| `libkomposti-ng.so` | Movescount native lib (32-bit ARM, unstripped) | Ghidra: NSP, BLE frame, saveRoutes, TreeToStruct, login |
| SuuntoLink JS (deobfuscated) | route.js, route_simplifier.js, navigation.js, poi.js, messages.js, variant.js, util.js, sttalg.js | transformation pipeline & limits (§4) |
| openambit source + wiki | libambit, device_driver_ambit*.c, movescountjson.cpp; offline how-to + JSON schema | Deliverable C; canonical route-file format (§3) |
| opensportsync source | Android USB/JNI + shared libambit | Deliverable B |
| gpx2route (centic9) | GPX → route-file JSON (Ambit1/2) | reference for GPX→model half |
| V2 handoff | modern-watch BLE handoff | **methodology only** — different BLE gen; do not reuse its UUIDs |
| Ambit3 firmware `Emu-fw_2.4.17-70.2.17414` | `SFI2` Suunto Firmware Image, **AES-128-ECB encrypted (key NOT held)** | **not directly analyzable now**; preserve for the contingency that the key is recovered (then it's the ultimate ground truth); also **pins the firmware version the captures/format correspond to** (§5 layout validated against fw 2.4.17). A sample payload for the FW-update transport (§16.5). |
| `Ibisbill-fw_2.4.17-70.2.17414.zip` | Same SFI2 format, confirmed downloadable (§16.5a) | Second data point proving `pkgId` is shared per joint-release, not per model |
| `Hoopoe-fw_2.0.5-72.1.0.zip` | Same SFI2 format, from a live SuuntoLink capture (§16.5a) | Only known-good `pkgId` for a non-Ambit3 legacy device |
| SuuntoLink 4.1.15 install tree (`Suuntolink.zip`) | Full unpacked Electron+native install: `SDSApplicationServer.exe`, `Devices.xml`, `production.json`, `suuntoapp.log`/`sds.log` runtime logs | Source of the §16.5a filename mechanism, VID/PID table, and both confirmed `pkgId` values above; same technique recovers `pkgId` for any future codename given physical access |

**Pcap parsing recipe:** libpcap global header 24 B; each record = 16-byte header
(`ts_sec, ts_usec, incl_len, orig_len`, u32 LE) + `incl_len` bytes. Link type 249 = USBPcap;
the USBPcap header's first u16 (LE) is its own length; endpoint @ offset 21, transfer type @ 22,
payload after the header. Ambit HID packets start `0x3f`; reassemble `MP=0x5d` (bytes[20:]) +
`MP=0x5e` (bytes[8:]); `0x0b16` payload = 8-byte write-head + body.

### 18.1 Captures to collect (which tool, which priority, what's already done)

**Tool depends on the operation.** The Ambit3 route/settings/POI/sport-mode path is **SuuntoLink
over USB** (the *app* can't do these). The **Suunto app** (BLE) only does activity sync, time, and
AGPS for the Ambit3. **USB captures = USBPcap/WinPcap (Windows) or `usbmon` (Linux). BLE captures =
an HCI sniff** (USBPcap does NOT see Bluetooth). Prefer the USB capture wherever the same data is
available over the cable; only do BLE sniffing for the genuinely wireless-only needs (iOS app, the
BLE login token §8.3).

**For every capture: record the exact input** you gave the tool (the route points, POI names/types,
the setting value) so you have matched input↔output ground truth — that pairing is what made the
route analysis solvable.

| Operation | Tool | Priority | Status / why |
|---|---|---|---|
| Route sync — **designed** inputs: a 3-point route, a route with a mid-route waypoint, a 10-point route | SuuntoLink / USB | **1 — do first** | **Needed.** Closes the variable-length 12/14-byte point encoding (§5.4) + confirms the waypoint flag. Highest-value capture. |
| Route delete / DB empty | SuuntoLink / USB | — | ✅ **Have it** (`routedelete`). Don't recapture. |
| POI import — 2–3 POIs of **different types** | SuuntoLink / USB | 1 | **Needed** for Deliverable C POIs (52-B POI descriptor + `0x0b25`/SBEM0102 payload). Have a 1-POI sample only. |
| Sport-mode / custom-mode write | SuuntoLink / USB | 2 | **Needed.** openambit has the *Ambit2* path; the **Ambit3** `CustomModes`/`apprules` write needs confirming (Deliverable C sport modes). |
| Settings read + write round-trip | SuuntoLink / USB | 2 | **Verify Ambit3.** Mechanism exists for Ambit2; confirm the Ambit3 settings memory map. |
| Activity / log download (USB) | SuuntoLink / USB | 3 | **Mostly ✅** — openambit already downloads Ambit3 logs over USB (PMEM20/SBEM). Capture only to extend/verify. |
| Activity sync (BLE) | Suunto app / **HCI** | 3 | **Needed** for §16.3 (3rd-party sync from phone) and any BLE activity path. Not done anywhere. |
| AGPS / orbital update (USB) | SuuntoLink / USB | 3 | **Needed for §16.4** — openambit has the *Ambit2* `gps_orbit_write`; the **Ambit3** SGEE (`updateSgeeFile`) path needs its own capture. (Data *source* is a separate problem.) |
| AGPS / orbital update (BLE) | Suunto app / **HCI** | 3 | Needed only if AGPS over BLE (iOS/Android apps). |
| Time sync | SuuntoLink / USB | low | ✅ **Mechanism exists** (`date_time_set`). Capture only if Ambit3 differs. |
| Firmware update | SuuntoLink / USB | **last** | **Needed only for §16.5**, and capture only when seriously pursuing it — highest bricking risk in the project. Maps the `UPDATE_MODE`→stream→verify→reset choreography. |

**Do NOT need to capture (already handled by openambit/opensportsync):** USB transport/HID framing;
the NSP protocol itself (decoded from `libkomposti`); anything **Ambit2** (routes, settings, modes,
logs, orbit all implemented — only the **Ambit3** equivalents are gaps); device connect/identify
(implemented — though the Ambit3 VID/PID/model handshake will appear in any capture you take and is
worth noting).

---

## 19. Methodology & write-safety discipline

- **A wrong body can reboot or wedge the watch.** Gate every mutating write behind a **dry-run**
  mode by default (log exact bytes, synthesize the ack, touch no hardware). Enable real writes
  one group at a time.
- **Stage on hardware in order:** delete/reset (safest) → single tiny route → larger route →
  multi-route → POIs → sport modes. Verify each on the watch before proceeding.
- **Validate offline first** — regenerate captured byte streams from their source GPX and diff
  against the pcaps before any hardware write.
- **Treat the watch as ground truth.** With no cloud oracle, the watch accepting and displaying/
  navigating the data is the only correctness signal. When this doc disagrees with a fresh
  capture, trust the capture.
- **For BLE token recovery:** HCI-sniff your own watch + the Suunto app — legal interop RE of
  your own devices.
- **Ethics/legality:** interoperability RE of devices you own, to put your own data on your own
  watch, replacing a dead service. No DRM present or circumvented. Don't redistribute Suunto
  firmware or the native library.

---

## 20. Load-bearing constants — quick reference

```
# Limits
maxRoutePoints 1000/route (guard >=0x3e9) · maxTotalRoutePoints 10000 · maxRoutes 50 (guard >0x32)
MAX_WAYPOINTS 100 (routes+POIs share) · maxNameLength 15 bytes ISO-8859-15

# Simplification
Douglas–Peucker: start tol 2 m, doubles, ceiling 131072 m · Earth 6371160 m (simplify) /
6378100 m (relDist) · 2D only

# Ambit3 flash regions (LE)
POI/wpt header 0x005000 (6B, count u16 @+2) · POI/wpt desc 0x005020 (52×count) · POI/wpt idx 0x16a370 (4×count)
route header 0x14c080 (32B; M u32 @+4, P u32 @+8) · route desc 0x14c0a0 (52×M; name[16] ISO-8859-15 @0)
route idx 0x169f88 (20×M) · route point body 0x14cac8+ (VARIABLE 12/14-byte recs, 0x7530 tag,
  relative-encoded — scale/origin + record-type flag UNKNOWN, §5.3/§5.4, finish via QEMU App.A)
Ambit2 route info/points 0x041EB0 / 0x042830 (reference; differs from Ambit3)

# USB / 0x0b16
write-head [u32 addr][u16 pack_len][u16 pack_seq=0] (8B) · chunk ≤1024, stride 0x400
HID packet start 0x3f; first MP=0x5d, cont MP=0x5e
cmds 0x0b16 data_write · 0x0b04 nav_memory_delete · 0x0b18 data_tail_len · 0x0b1b write_start ·
     0x0b25 POI/SBEM0102 · 0x1201 close · 0x0b19/0x0b1a lock (cosmetic "Sync" display only)
USB device login: NONE

# NSP header (12B, LE)
[u8 msgId][u8 subId][u8 flags][u8 errFlags][u16 connId][u16 pktNum][u32 dataSize<0x415]
flags 0x01 PC 0x02 DEVICE 0x04 REQUIRE_ACK 0x08 ACK 0x10 ENCRYPTED 0x20 DATA_CONTINUE
msgId 0 QUERY, 1 LOGIN(sub0)/LOGOUT(sub1)/ISALIVE(sub2), 2 SYSTEM
login: LOCAL, BLE-only; LOGIN body = 16-byte token (dataSize=8); token derivation UNKNOWN (sniff)

# BLE (Ambit3 "NSP" service)
company id 0x009F · service 98ae7120-e62e-11e3-badd-0002a5d5c51b
write c6339440-e62e-11e3-a5b3-0002a5d5c51b · notify d0fd6b80-e62e-11e3-a2e9-0002a5d5c51b
CCCD 00002902-… · BLE frame = dumb 20-byte fragmenter (no delimiter/escape/CRC)

# Family codenames (full table incl. VID:PID in §10)
Bluebird=Ambit Duck=Ambit2 Greentit=Ambit2R Colibri=Ambit2S
Emu=Ambit3Peak Ibisbill=Ambit3R Finch=Ambit3S Kaka=Ambit3V · Jabiru=Traverse Loon=TraverseAlpha
Hoopoe=Kailash

# Auth summary
Movescount account (email+userkey): cloud fetch ONLY, dead, bypass with local files.
Watch write: no account, no server. USB: no login. BLE: local session login (token TBD).

# Firmware image acquisition (§16.5a)
URL: firmware.geo.movescount.com/production/<Codename>-fw_<swVersion>-<pkgId>.zip (SFI2, AES-128-ECB)
pkgId is READ FROM WATCH via NSP QUERY (taskQueryDevice → "hw version"), echoed by backend into
  the URL — NOT hardcoded/derivable offline, no static codename→pkgId table exists anywhere.
pkgId ~= <namespace>.<sub>.<serial>; namespace bumps at backend migration (69.x Movescount →
  70.x post-migration, Feb 2021 cutover); serial stable across migration; shared per joint
  release (Emu+Ibisbill both 70.2.17414 @ sw2.4.17) not per model/unit.
Known: Emu/Ibisbill(/Finch predicted) 70.2.17414 @ 2.4.17 · Hoopoe 72.1.0 @ 2.0.5
Legacy REST (DEAD): uiservices.movescount.com/devices/<Codename>/<pkgId>/<swVersion>/binary?appkey=...
Current REST: devices.suunto-operations.com (path uncaptured)
appkey (shared static, not per-install): <APPKEY>, in SuuntoLink's
  production.json and in openambit's mainwindow.cpp; also logged by suuntoapp.log
```

---

## Appendix A — Dynamic analysis on an x86 Linux box (QEMU): the designated finish path

Two remaining unknowns are **dynamic** tasks, not static ones: the route-point coordinate
scale/origin + record-type flag (§5.3/§5.4), and the BLE session-login 16-byte token (§8.3). Both
are best solved by **executing** parts of the 32-bit ARM `libkomposti-ng.so` under emulation.

**Why a specific machine.** `libkomposti-ng.so` is 32-bit ARM (ARMv7). Apple Silicon (M-series)
**cannot execute** 32-bit ARM at all, so on a Mac this library is static-only (Ghidra
decompilation — great for reading, useless for running). An **x86-64 Linux machine** (e.g. a
ThinkPad X230 running Linux Mint) **can** run it via `qemu-arm` user-mode emulation. Do the heavy
Ghidra *reading* on the fast machine; do the *running* here.

**Setup (Debian/Ubuntu/Mint):**
```
sudo apt install qemu-user qemu-user-static gdb-multiarch \
                 libc6-armhf-cross libstdc++6-armhf-cross   # armhf runtime for the .so
# run an armhf binary that dlopen()s libkomposti under qemu, with the arm libs on the path:
qemu-arm -L /usr/arm-linux-gnueabihf ./harness
# or attach a debugger:
qemu-arm -g 1234 -L /usr/arm-linux-gnueabihf ./harness &
gdb-multiarch ./harness -ex 'target remote :1234'
```

**Task 1 — route-point encoding (§5.4).** Two options, either sufficient:
- **(a) Dump the relocated StructMap.** `DAT_00d2c458` is a `{name→offset→type→unit}` table whose
  pointers are filled at load time (they're zero in the static file). Under QEMU, once the library
  is loaded, read that address from **process memory** (gdb: `x/40xw &DAT_00d2c458`, or resolve
  the symbol) — the pointers are now valid, so each entry's `name` string, byte offset, type code,
  and unit are readable. That *is* the field grammar, including the 12-vs-14-byte rule.
- **(b) Call the serializer.** Write a small armhf C harness that `dlopen`s the library, builds a
  `boost::property_tree` for a **hand-made 2–3-point route** (one plain point, one waypoint), and
  calls the route-point serialization path (`Communist::Serialization::TreeToStruct` with the
  route-point StructMap, or the higher-level `saveRoutes`). Read the emitted bytes. Feeding known
  inputs and reading exact outputs pins scale, origin, and the waypoint flag immediately.
- **Verify** either result against the matched fixtures (`route12km`+`Gare-du-Nord.gpx`,
  `route128km`+`Grand-Tour.gpx`) — regenerate the captured bytes exactly before trusting it.

**Task 2 — BLE session-login token (§8.3).** The 16-byte token handed to `NspEndDevice::login`
is derived locally from the device serial (no server). To recover the transform without an
Android sniffer: under QEMU, call the derivation path with a **known serial** and read the 16
output bytes; repeat with a second serial to confirm the mapping. (If you later get any Android
device that runs the Suunto app, a single HCI sniff of a real login independently confirms it —
read the serial in the QueryDevice reply and the 16 token bytes in the LOGIN body.)

**General tips.** Keep harnesses tiny and single-purpose. If full `dlopen` is awkward (C++ static
initializers, missing deps), an alternative is `qemu-arm` + gdb to **call a single function** at
its address with crafted register/stack state and breakpoint on return. Log every input/output
pair and check against captures — the watch and the captures remain the ground truth (§19).

---

*End of handoff. No server or account is needed to write to the watch (proven at the code level
and by openambit's offline CLI). USB has no login; BLE has a local session login whose token is
the one wireless unknown (recover by sniffing the live Suunto app). The transports and the
region-level route format are fully mapped; the remaining format task is the route-point
coordinate encoding (§5.3/§5.4 — structure known, scale/origin to recover dynamically per
Appendix A), which has matched GPX↔capture fixtures. Build the serializer once (Deliverable
C, cable — easiest to debug), reuse it for BLE (A, iOS) and opensportsync (B). Keep content
producers separate from the watch-write core so the future features in §16 slot in cleanly.
Trust the captures and the watch over this document.*
