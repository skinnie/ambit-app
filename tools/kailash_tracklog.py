#!/usr/bin/env python3
"""Dumps the Suunto Kailash's `TrackLog` flash region and decodes it - a real, confirmed
20-byte fixed-stride GPS record format, found 2026-08-08 against real hardware after the
initial hypothesis (reusing Ambit3's own `ExerciseLog` PMEM20 format) was tried and cleanly
falsified (no PMEM magic, implausible master-index numbers - see git history/
`custom_modes_andre.md` for that attempt).

**Real format, confirmed against real hardware, not guessed:**

    offset  size  field
    0       4     lat, int32 LE, degrees * 1e7 (same convention as this project's own
                   WaypointDescriptor/exercise_log.py samples)
    4       4     lon, int32 LE, degrees * 1e7
    8       4     third field - real values cluster tightly (500,000-2,200,000), plausibly
                   altitude in millimeters (500-2200m - real, physically sensible elevation
                   for the actual real terrain the confirmed coordinates below sit in).
                   Not fully confirmed (no independent altitude source cross-checked yet),
                   kept as a raw field rather than asserted as "Altitude" outright.
    12      1     flags/type byte - 0x00 on every real record seen; a real record must have
                   this to avoid false-positives against the region's own unused/padding tail
    13      2     year, u16 LE (confirmed: 0x07ea = 2026, matching the real capture date)
    15      1     month
    16      1     day
    17      1     hour
    18      1     minute
    19      1     sub-field - real values span the full 0-255 byte range, not 0-59, so this
                   is *not* a plain seconds field; plausibly a sub-second tick counter.
                   Reported raw, not asserted.

Confirmed against real hardware, 2026-08-08: 56 consecutive real-looking records (index 1-56;
index 0 has a completely different byte shape - almost certainly a header/init record, not a
GPS fix, and is skipped) spanning 2026-08-02 through 2026-08-07, lat ~74.7-75.8, lon ~-76 to
-79 - real, physically coherent Canadian high-Arctic coordinates (Ellesmere Island area) that
vary smoothly point to point, exactly like a real walked/hiked GPS track, not noise. Past
record 56 the same fields degrade into implausible values (year outside a real range, etc.) -
the same "real data, then unused flash" pattern already established for Ambit3's own
ExerciseLog, not a bug.

    ./tools/kailash_tracklog.py --gpx-out /tmp/kailash_track.gpx
    ./tools/kailash_tracklog.py --from /tmp/tracklog_dump.bin --gpx-out /tmp/kailash_track.gpx
"""

import argparse
import struct
import sys

RECORD_SIZE = 20

# From the real kailash capture's own 0x0b21 memory-map reply, parsed directly (see
# custom_modes_andre.md's "Kailash" section for the full region table) - not guessed.
TRACKLOG_BASE = 0x48A1C0
TRACKLOG_SIZE = 1310713


def walk_records(data):
    """Every 20-byte slot that looks like a real GPS fix, in order, stopping at the first
    run of implausible ones (the region's own unused/padding tail - see module docstring)."""
    n = len(data) // RECORD_SIZE
    bad_streak = 0
    for i in range(n):
        rec = data[i * RECORD_SIZE:(i + 1) * RECORD_SIZE]
        lat, lon, third = struct.unpack_from("<iii", rec, 0)
        flags = rec[12]
        year = struct.unpack_from("<H", rec, 13)[0]
        month, day, hour, minute, sub = rec[15], rec[16], rec[17], rec[18], rec[19]
        plausible = (
            flags == 0
            and 2015 <= year <= 2035 and 1 <= month <= 12 and 1 <= day <= 31
            and hour <= 23 and minute <= 59
            and -900000000 <= lat <= 900000000 and -1800000000 <= lon <= 1800000000
            # Real bound, not guessed: every confirmed record's own "third" field clusters
            # tightly in 500,000-2,200,000 - wide enough for real variation, still narrow
            # enough to reject record 0's own 956,315,666 (a different-shaped header/init
            # record whose lat/lon alone happen to fall in-range too, so this field is what
            # actually tells the two apart).
            and 100000 <= third <= 5000000
        )
        if plausible:
            bad_streak = 0
            yield {
                "index": i, "lat": lat / 1e7, "lon": lon / 1e7, "third_raw": third,
                "year": year, "month": month, "day": day, "hour": hour, "minute": minute,
                "sub": sub,
            }
        else:
            bad_streak += 1
            if bad_streak > 5:
                return


def to_gpx(points):
    lines = ['<?xml version="1.0" encoding="UTF-8"?>',
             '<gpx version="1.1" creator="ambit-app kailash_tracklog.py">',
             "  <trk><name>Kailash TrackLog</name><trkseg>"]
    for p in points:
        t = f"{p['year']:04d}-{p['month']:02d}-{p['day']:02d}T{p['hour']:02d}:{p['minute']:02d}:00Z"
        lines.append(f'    <trkpt lat="{p["lat"]:.7f}" lon="{p["lon"]:.7f}">'
                     f'<time>{t}</time></trkpt>')
    lines.append("  </trkseg></trk>")
    lines.append("</gpx>")
    return "\n".join(lines) + "\n"


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--from", dest="from_file", metavar="FILE",
                     help="decode a raw TrackLog dump instead of the watch")
    ap.add_argument("--save", metavar="FILE",
                     help="also save the raw region bytes here (live read only)")
    ap.add_argument("--gpx-out", metavar="FILE",
                     help="write every real-looking point as one GPX track file")
    args = ap.parse_args()

    if args.from_file:
        with open(args.from_file, "rb") as f:
            data = f.read()
    else:
        from write_nav import Link, read_flash
        link = Link(dry_run=False, verbose=False)
        print("read-only: 0x0b17 reads flash, nothing is written")
        link.open()
        data = read_flash(link, TRACKLOG_BASE, TRACKLOG_SIZE, label="TrackLog")
        if args.save:
            with open(args.save, "wb") as f:
                f.write(data)
            print(f"\nsaved raw dump to {args.save}")

    points = list(walk_records(data))
    print(f"{len(points)} real-looking GPS record(s) found")
    for p in points[:20]:
        print(f"  [{p['index']:5}] {p['year']:04d}-{p['month']:02d}-{p['day']:02d} "
              f"{p['hour']:02d}:{p['minute']:02d}  lat={p['lat']:.5f} lon={p['lon']:.5f}  "
              f"third_raw={p['third_raw']}")
    if len(points) > 20:
        print(f"  ... and {len(points) - 20} more")

    if args.gpx_out:
        if points:
            with open(args.gpx_out, "w") as f:
                f.write(to_gpx(points))
            print(f"\nwrote {args.gpx_out} ({len(points)} track point(s))")
        else:
            print("\nno real-looking points - not writing an empty GPX file")

    return 0


if __name__ == "__main__":
    sys.exit(main())
