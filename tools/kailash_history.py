#!/usr/bin/env python3
"""Reads the Suunto Kailash's real on-watch `sml.DeviceHistory` object live - the same data
shown on the watch's own "7R" button screen (visited cities/countries, travel stats) plus, as
a real bonus found in the same reply, the "activity mode" logbook (`LogHeaders`) this project
had separately been unable to locate in flash.

**Real mechanism, confirmed working end to end against real hardware, 2026-08-08**: the
existing `0x1200` object-by-identifier query (`write_nav.py`'s own `CMD_LOG_HEADERS`, already
used there for `sml.DeviceLogBook`, entry `0x8d`) also answers for `sml.DeviceHistory`, entry
`0x67` - found via this exact watch's own real SBEM schema descriptor (`assets/APK/kailash/
Suunto 7R/Container/Documents/descr+79DC39510E000100+2.0.5`, `tools/sbem_schema.py --group
0x67` lists every field). Cross-checked field by field against what the watch's own screen and
the `7R` iOS app's local database (`7r-trackLog.db`, `device_history` table) show for the same
real watch: `NumberOfVisitedPlaces`/`NumberOfVisitedCountries`=1/1 (Lille, France),
`TravellingDays`/`TravelledDistance`/`FurthestFromHome`=0/0/0 - exact match.

Two unit conversions applied here that `sbem_schema.py`'s own `decode_entry()` deliberately
does *not* apply (it only unpacks the raw stored type - the `<MOD>` conversion is documented
in the schema text but is a free-form formula, not something the generic decoder evaluates):
`LogHeaders.Header.Duration` is `raw/10` seconds (confirmed against the schema's own
`<MOD>x/10,y*10`), `Speed.Max` is `raw/360` (`<MOD>x/360,y*360`, unit unconfirmed - m/s is
plausible but not independently checked). `VisitedCities...Location.Longitude/Latitude` are
a real, separate case: plain `float32`, genuinely different from every *other* lat/lon field
in this same schema (all `int32`, degrees*1e7) - decoding them as degrees directly gives
implausible values (~0.05, ~0.88); as **radians** (`value * 180 / pi`), they land exactly on
Lille's real coordinates, confirming the unit even though the descriptor's own `<MOD>` tag for
these two specific fields is empty.

    ./tools/kailash_history.py
"""

import math
import struct
import sys

from write_nav import CMD_LOG_HEADERS, Link
import sbem_schema

DEVICE_HISTORY_ENTRY = 0x67
HISTORY_REQUEST = (bytes.fromhex("00000000") + (1).to_bytes(2, "little")
                   + (10).to_bytes(2, "little") + b"SBEM0102"
                   + bytes([DEVICE_HISTORY_ENTRY, 0x00]))

# Real bug, found live 2026-08-08: sbem_schema.default_descriptor() globs for
# `descr+*+{REFERENCE_FW}` where REFERENCE_FW is hardcoded to the *Ambit3's* own reference
# firmware ("2.4.17") - silently wrong for Kailash. It doesn't fail cleanly either: if any
# real Ambit3 descriptor happens to exist in assets/, it loads that one instead and applies
# *its* field-ID meanings to Kailash's actual reply bytes, corrupting exactly the fields whose
# IDs mean something different-sized in the two schemas (0x55/0x5e here) while leaving others
# looking fine by coincidence - real, reproducible, silent corruption, not a crash. Kailash
# needs its own real descriptor explicitly, not the generic Ambit3-reference lookup.
KAILASH_DESCRIPTOR = (sbem_schema.ASSETS / "APK" / "kailash" / "Suunto 7R" / "Container"
                       / "Documents" / "descr+79DC39510E000100+2.0.5")


def main():
    link = Link(dry_run=False, verbose=False)
    print("read-only: the 0x1200 sml.DeviceHistory query, nothing is written")
    link.open()
    payload = link.command(CMD_LOG_HEADERS, HISTORY_REQUEST)

    head = payload.find(sbem_schema.MAGIC)
    if head < 0:
        print("no SBEM0102 payload in the reply")
        return 1

    descriptor = KAILASH_DESCRIPTOR
    if not descriptor.exists():
        print(f"CANNOT DECODE: the real Kailash descriptor is missing - expected it at "
              f"{descriptor}\n(a real file from a real 7R app container extraction; see "
              f"custom_modes_andre.md's Kailash section for where it came from).")
        return 1
    schema = sbem_schema.load(descriptor)
    entries = list(sbem_schema.entries(payload[head:]))

    summary = {}
    location = None
    country = None
    sessions = []
    for entry_id, data in entries:
        try:
            records = schema.decode_entry(entry_id, data) or []
        except (ValueError, IndexError, UnicodeDecodeError, struct.error) as exc:
            print(f"  (couldn't decode entry 0x{entry_id:02x}, {len(data)} bytes: {exc} - "
                  f"skipped, not fatal)")
            continue
        for record in records:
            fields = {schema.field_name(entry_id, f.fid): v for f, v in record}
            if entry_id == 0x5B:  # VisitedCities...Location - float32 radians, see docstring
                lon_rad, lat_rad = fields.get("Longitude"), fields.get("Latitude")
                if lon_rad is not None and lat_rad is not None:
                    location = (lat_rad * 180 / math.pi, lon_rad * 180 / math.pi)
            elif entry_id == 0x5C:
                country = fields.get("CountryCode")
            elif entry_id == 0x66:  # LogHeaders.Header - real "activity mode" logbook entry
                sessions.append({
                    "when": fields.get("DateTime"),
                    "duration_s": (fields.get("Duration") or 0) / 10,
                    "distance_m": fields.get("Distance"),
                    "max_speed": (fields.get("Speed.Max") or 0) / 360,
                })
            else:
                summary.update(fields)

    name = summary.get("sml.DeviceHistory.Device.Name")
    serial = summary.get("sml.DeviceHistory.Device.SerialNumber")
    print(f"\n{name} ({serial})")
    print(f"  Cities visited:    "
          f"{summary.get('sml.DeviceHistory.Histories.History.VisitedCities.NumberOfVisitedPlaces')}"
          + (f"  (last known: {location[0]:.4f}, {location[1]:.4f})" if location else ""))
    print(f"  Countries visited: "
          f"{summary.get('sml.DeviceHistory.Histories.History.VisitedCountries.NumberOfVisitedCountries')}"
          + (f"  ({country})" if country else ""))
    print(f"  Last known time:   "
          f"{summary.get('sml.DeviceHistory.Histories.History.LastKnownTime')}")
    print(f"  Travelling days:   "
          f"{summary.get('sml.DeviceHistory.Histories.History.TravellingDays')}")
    print(f"  Travelled distance:"
          f" {summary.get('sml.DeviceHistory.Histories.History.TravelledDistance')} m")
    print(f"  Cumulated distance:"
          f" {summary.get('sml.DeviceHistory.Histories.History.CumulatedDistance')} m")
    print(f"  Furthest from home:"
          f" {summary.get('sml.DeviceHistory.Histories.History.FurthestFromHome')} m")

    if sessions:
        print(f"\n{len(sessions)} activity-mode logbook entry(ies) "
              "(a real, separate system from the passive TrackLog - see "
              "custom_modes_andre.md's Kailash section):")
        for s in sessions:
            print(f"  {s['when']}  duration={s['duration_s']:.1f}s  "
                  f"distance={s['distance_m']}m  max_speed={s['max_speed']:.2f} (raw/360 unit)")

    return 0


if __name__ == "__main__":
    sys.exit(main())
