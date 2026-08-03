# Ambit3 Route Encoding — Update from SuuntoLink Data Dump

**Source:** `Suuntolink.zip` — full SuuntoLink (SDSApplicationServer / Electron UI) application
data folder for device `<SERIAL>` ("Emu" / Ambit3 Peak, fw 2.4.17).

**Status change:** The coordinate scale mapping, previously marked *unsolved* in
`ROUTE_ENCODING_SUMMARY.md`, is now resolved (pending on-wire USB confirmation — see
"What's still open" below). Merge the sections below into the existing doc.

---

## 1. Coordinate scale — SOLVED

Found in `descr+<SERIAL>+2.4.17`, an SBEM0102-format binary schema dictionary that
SuuntoLink downloads per device/firmware. It defines every SML field path, its wire format, and
(for scaled numeric fields) a `<MOD>` conversion formula between the raw on-device value and the
SML engineering value.

Relevant entries:

```
sml.WayPoint.Location.Latitude                                      FRM=int32
  MOD: PI*x/(10^7*180)   [forward: raw -> engineering]
       y*10^7*180/PI     [reverse: engineering -> raw]

sml.WayPoint.Location.Longitude                                     FRM=int32
  MOD: PI*x/(10^7*180) / y*10^7*180/PI   (same formula)

sml.Navigation.PointsOfInterest.PointOfInterest.Location.Latitude   FRM=int32   (same MOD)
sml.Navigation.PointsOfInterest.PointOfInterest.Location.Longitude  FRM=int32   (same MOD)
```

**Reading the formula:** `PI*x/(10^7*180)` is `x * 1e-7 * (π/180)` rearranged — i.e.
`degrees_to_radians(x * 1e-7)`. So:

- **Raw int32 on the device = decimal degrees × 10^7** (standard 1e‑7° / ~1.1 cm precision,
  same scale used by many GPS binary formats).
- SML's internal "engineering value" (what the `<MOD>` forward formula produces) is in
  **radians**, not degrees. That's a SuuntoLink/SML-internal representation detail — it does
  **not** mean the wire encoding uses radians.

**Practical formula for openambit:**

```c
int32_t encode_coord_deg(double degrees) {
    return (int32_t)llround(degrees * 1e7);
}

double decode_coord_deg(int32_t raw) {
    return raw / 1e7;
}
```

This should replace whatever placeholder/guessed scale factor is currently in
`navigation_write` / route point encoding logic.

## 2. WayPoint record layout (from same descriptor)

A route on the Ambit3 is modeled as a set of `WayPoint` records sharing a `RouteName` /
`RouteIndex` — there is **no separate `RoutePoint` object** in the device's SML schema. Full
field list with wire types:

| SML path                    | Wire type |
|------------------------------|-----------|
| `sml.WayPoint.Name`          | utf8      |
| `sml.WayPoint.RouteName`     | utf8      |
| `sml.WayPoint.Timestamp`     | utf8      |
| `sml.WayPoint.RouteIndex`    | uint8     |
| `sml.WayPoint.Type`          | uint8     |
| `sml.WayPoint.SubType`       | uint8     |
| `sml.WayPoint.TypeIndex`     | uint8     |
| `sml.WayPoint.Flags`         | uint8     |
| `sml.WayPoint.Location.Latitude`  | int32 (see §1) |
| `sml.WayPoint.Location.Longitude` | int32 (see §1) |

The parallel `sml.Navigation.PointsOfInterest.PointOfInterest.*` branch has an identical shape
and is used for standalone POIs rather than route-associated waypoints; it also carries
`Status.IsMcSynced` (bool) and `Status.Timestamp` (utf8) at the collection level.

Note: this descriptor has no explicit `Altitude` field on `WayPoint`/`PointOfInterest` — altitude
travels in the SDS JSON layer (§3) but may not round-trip to the device the same way, or may be
carried in a field not present in this particular firmware's descriptor. Worth checking the 2.0.5
("Hoopoe") descriptor for contrast, and worth confirming against a live capture.

## 3. SDS REST layer — plaintext route contract (pre-encoding)

`suuntoapp.log` (SuuntoLink's application-level trace, distinct from the low-level USB/serial
layer) logs every `suunto://SDS/...` request/response the desktop app makes. Captured on
2026-07-31, a full `POST suunto://SDS/Routes/<SERIAL>`:

```json
{
  "Header": {
    "id": 1,
    "name": "Grand Tour HDF ",
    "activityId": 2,
    "distance": 128723.84,
    "lastModifiedDate": 1784679934877,
    "routePointCount": 852,
    "ascent": 530.54,
    "descent": 634.70
  },
  "Data": {
    "routePoints": [
      {"latitude": 50.636753, "longitude": 3.063923, "altitude": 24.590717,
       "distance": 0, "relativeDistance": 0},
      {"latitude": 50.6367, "longitude": 3.06409, "altitude": 24.590717,
       "distance": 13.18, "relativeDistance": 0.0001028},
      ...
    ]
  }
}
```

Response: `200 OK`, empty body, `Uri: suunto://SDS/Routes/<SERIAL>`.

This is the layer **above** the SBEM/USB encoding — it's the plaintext, pre-encoding
representation that SuuntoLink's SDS service consumes before it presumably calls into the SBEM
schema (§1–2) to produce the on-wire route point + waypoint records for the actual
`sport_mode_write`/`app_data_write` USB transfer. Notably:

- Coordinates here are plain decimal degrees (not yet scaled/encoded).
- Each point also carries a running `distance` (m) and `relativeDistance` (fraction 0–1) —
  precomputed by the app, not something the device likely needs to derive itself, but worth
  checking whether the device consumes it or recomputes it.
- `routePointCount: 852` for this route, but the SDS payload doesn't obviously downsample —
  worth checking whether the *device-side* encoding downsamples/simplifies before writing (Ambit
  route point limits are typically much lower than 852).

Also captured: `GET .../SportMode/<id>/Groups` and `.../SportMode/<id>/Settings/<modeID>` showing
how a "Run a route" custom sport mode (`CustomModeID 60599`) is structured, including
`NavigationSelection`, trigger config, and POD usage flags — useful context if the sync flow
needs to activate/select a specific sport mode alongside pushing the route itself.

## 4. What's still open

- **No USB/HID capture in this dump** — `suuntoapp.log` only shows the SDS (app-internal REST)
  layer, not the raw bytes going out over USB. The coordinate scale is now known from the schema
  definition, but it hasn't been *confirmed* against an actual `sport_mode_write`/
  `app_data_write` capture yet. Next concrete step: take a USB capture while syncing a route with
  a small, known set of coordinates (e.g. 2–3 points at recognizable lat/lon values) and verify
  the int32×1e7 encoding shows up literally in the payload.
- Whether/how the device downsamples 852-point routes to its internal storage limit is still
  unknown.
- Altitude encoding for WayPoint/route points isn't defined in this descriptor — needs its own
  capture or a look at the 2.0.5 descriptor for comparison.
- The `<MOD>` radian conversion is SML-internal bookkeeping (confirmed to just be
  degrees→radians); it's not expected to affect the wire format, but flagging in case downstream
  SML-consuming code (if any is reused) expects radians rather than the raw int32.

## 5. Housekeeping note

`Suuntolink.zip` also contained `suuntolink_data.json` with live OAuth access/refresh tokens for
the associated Suunto account. Not reproduced here — if this dump is shared further, rotate those
credentials first.
