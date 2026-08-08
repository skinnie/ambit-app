#!/usr/bin/env python3
"""Dumps the Suunto Kailash's `TrackLog` flash region and decodes it - a real, confirmed
20-byte fixed-stride GPS record format, found 2026-08-08 against real hardware after the
initial hypothesis (reusing Ambit3's own `ExerciseLog` PMEM20 format) was tried and cleanly
falsified (no PMEM magic, implausible master-index numbers - see git history/
`custom_modes_andre.md` for that attempt).

**Real format, confirmed against real hardware AND a real known location, corrected once
already - worth reading, not just trusting the numbers below:** the first pass at this had
every field right except the record boundary, off by exactly one byte. That misalignment
still produced smoothly-varying, plausible-*looking* coordinates (a real, coherent-seeming
track through the Canadian Arctic) - "varies smoothly" alone was not proof of a correct
decode, and it took André pointing out the real location should be Lille, France for the
actual bug (a one-byte record-boundary shift) to surface. Corrected by searching the raw bytes
directly for Lille's own real coordinates (~50.63N, ~3.06E) rather than trusting the earlier
alignment, which is what pinned the true record start.

    record stride: 20 bytes, starting at region offset 1 - the region's own byte 0 is a real,
    currently-unexplained leading byte, not part of any record

    offset  size  field
    0       4     lat, int32 LE, degrees * 1e7 (same convention as this project's own
                   WaypointDescriptor/exercise_log.py samples)
    4       4     lon, int32 LE, degrees * 1e7
    8       4     third field - real values cluster in the low thousands (roughly
                   2,000-9,000 across real records) - unit/meaning not confirmed
                   (accuracy/HDOP is plausible; not cross-checked against another source)
    12      2     year, u16 LE (confirmed: 0x07ea = 2026, matching the real capture date)
    14      1     month
    15      1     day
    16      1     hour
    17      1     minute
    18      2     two more bytes, real values, no clear pattern found yet - reported raw,
                   not asserted (a sub-second/sequence/checksum field is plausible, unconfirmed)

Confirmed against real hardware, 2026-08-08: 56 consecutive real-looking records (index 1-56;
index 0 has a completely different byte shape, unrelated third-field magnitude and an
implausible lat - almost certainly a header/init record, not a GPS fix, and is skipped)
spanning 2026-08-02 through 2026-08-07, coordinates matching André's own real, independently
known location (Lille, France) closely and consistently across every real record - the actual
confirmation, not just "looks smooth." Past record 56 the same fields degrade into implausible
values - the same "real data, then unused flash" pattern already established for Ambit3's own
ExerciseLog, not a bug.

    ./tools/kailash_tracklog.py --gpx-out /tmp/kailash_track.gpx
    ./tools/kailash_tracklog.py --from /tmp/tracklog_dump.bin --gpx-out /tmp/kailash_track.gpx
"""

import argparse
import json
import math
import re
import struct
import sys
from datetime import datetime, timedelta

RECORD_START = 1
RECORD_SIZE = 20

# From the real kailash capture's own 0x0b21 memory-map reply, parsed directly (see
# custom_modes_andre.md's "Kailash" section for the full region table) - not guessed.
TRACKLOG_BASE = 0x48A1C0
TRACKLOG_SIZE = 1310713


def walk_records(data):
    """Every 20-byte slot (starting at RECORD_START, not 0) that looks like a real GPS fix,
    in order, stopping at the first run of implausible ones (the region's own unused/padding
    tail - see module docstring)."""
    n = (len(data) - RECORD_START) // RECORD_SIZE
    bad_streak = 0
    for i in range(n):
        off = RECORD_START + i * RECORD_SIZE
        rec = data[off:off + RECORD_SIZE]
        lat, lon, third = struct.unpack_from("<iii", rec, 0)
        year = struct.unpack_from("<H", rec, 12)[0]
        month, day, hour, minute = rec[14], rec[15], rec[16], rec[17]
        trailer = rec[18:20]
        plausible = (
            2015 <= year <= 2035 and 1 <= month <= 12 and 1 <= day <= 31
            and hour <= 23 and minute <= 59
            and -900000000 <= lat <= 900000000 and -1800000000 <= lon <= 1800000000
            # Real bound, not guessed: every confirmed record's own "third" field clusters
            # tightly (roughly 2,000-9,000) - wide enough for real variation, still narrow
            # enough to reject record 0's own 3,735,608 (a different-shaped header/init
            # record whose date fields alone happen to look valid too, so this field is what
            # actually tells the two apart).
            and 500 <= third <= 50000
        )
        if plausible:
            bad_streak = 0
            yield {
                "index": i, "lat": lat / 1e7, "lon": lon / 1e7, "third_raw": third,
                "year": year, "month": month, "day": day, "hour": hour, "minute": minute,
                "trailer": trailer,
            }
        else:
            bad_streak += 1
            if bad_streak > 5:
                return


def haversine_meters(lat1, lon1, lat2, lon2):
    """Great-circle distance - the same formula this project already uses elsewhere
    (desktop/src/services/garminservice.cpp's own haversineMeters()), not re-derived."""
    r = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return r * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def to_activity(points):
    """One activity-shaped dict, the same field names desktop/src/services/garminservice.cpp
    (ActivityService.activities) already uses, so the existing ActivityCard/MapView QML
    components can show this with no new UI code: name/startTime/distanceMeters/
    durationSeconds/track/gpxText. No ascent/FIT here - TrackLog carries no altitude field
    confirmed yet (see custom_modes_andre.md), and there's no FIT writer for this format."""
    if not points:
        return None
    first, last = points[0], points[-1]
    start = f"{first['year']:04d}-{first['month']:02d}-{first['day']:02d}T" \
            f"{first['hour']:02d}:{first['minute']:02d}:00Z"
    end_minutes = (last["day"] - first["day"]) * 1440 + \
        (last["hour"] - first["hour"]) * 60 + (last["minute"] - first["minute"])
    distance = sum(haversine_meters(a["lat"], a["lon"], b["lat"], b["lon"])
                   for a, b in zip(points, points[1:]))
    return {
        "name": "Kailash TrackLog",
        "startTime": start,
        "distanceMeters": round(distance, 1),
        "durationSeconds": max(0, end_minutes * 60),
        "track": [{"lat": p["lat"], "lon": p["lon"]} for p in points],
        "gpxText": to_gpx(points),
    }


def _parse_when(when_str):
    """Pulls (year, month, day, hour, minute) out of a real DeviceHistory
    Header.DateTime string (kailash_history.py's own `sessions[].when` - a real utf8
    field, confirmed via sbem_schema.load(KAILASH_DESCRIPTOR).fields, but this project has
    never captured a live sample of its exact separator formatting). Only the digit run
    matters here - tolerant of "-"/":"/"T"/" " or no separator at all - since TrackLog's own
    points are only ever compared at minute resolution anyway."""
    m = re.match(r"(\d{4})\D?(\d{2})\D?(\d{2})\D?(\d{2})\D?(\d{2})", when_str or "")
    if not m:
        return None
    y, mo, d, h, mi = (int(x) for x in m.groups())
    try:
        return datetime(y, mo, d, h, mi)
    except ValueError:
        return None


def split_into_activities(points, sessions):
    """One activity per real DeviceHistory session (kailash_history.py's own `sessions` -
    the watch's "activity mode" logbook), correlating each session's own [when, when +
    duration] window against TrackLog's own per-point timestamps. Real request 2026-08-09
    ("Something is bizarre on the activities, they say no gps, but they have gps") -
    DeviceHistory sessions carry summary stats only (no GPS of their own, see
    kailash_history.py's own docstring), and until now ActivitiesPage.qml filled every
    Kailash "Walk" card's track with an empty placeholder. This is what actually supplies it.

    A +/-2 minute tolerance is applied on both ends: TrackLog points are minute-resolution
    and Header.Duration is tenths-of-a-second, two independently-derived clocks off the same
    watch, so exact-window matching would drop real points to real clock/rounding drift
    between the two sources.

    Always returns exactly one entry per session, in the same order `sessions` came in -
    ActivitiesPage.qml zips this 1:1 against KailashService.sessions by index (both ultimately
    decode the same real wire data in the same order, from two separate backend calls). A
    session with no correlated points gets a real, honest empty track rather than being
    dropped, matching this project's original per-session behaviour for the case where TrackLog
    genuinely doesn't cover it (e.g. a session predating this watch's TrackLog capture start).
    distanceMeters/durationSeconds/startTime always come from the session's own real watch-
    reported stats, not the GPS-derived approximation - only `track`/`gpxText` come from
    TrackLog, since a haversine sum over minute-resolution points is strictly less accurate
    than the watch's own reported values.

    Falls back to one bundled activity covering every point (this project's original,
    pre-2026-08-09 behaviour) only when there are no sessions to correlate against at all
    (e.g. the DeviceHistory query itself failed) - still shows something rather than nothing."""
    if not sessions:
        activity = to_activity(points)
        return [activity] if activity else []

    point_dts = []
    for p in points:
        try:
            point_dts.append((datetime(p["year"], p["month"], p["day"], p["hour"], p["minute"]), p))
        except ValueError:
            continue

    activities = []
    for s in sessions:
        matched = []
        start = _parse_when(s.get("when"))
        if start is not None:
            end = start + timedelta(seconds=s.get("duration_s") or 0)
            lo, hi = start - timedelta(minutes=2), end + timedelta(minutes=2)
            matched = [p for dt, p in point_dts if lo <= dt <= hi]

        activity = to_activity(matched) or {
            "name": "Kailash Walk", "startTime": None, "distanceMeters": 0,
            "durationSeconds": 0, "track": [], "gpxText": "",
        }
        activity["name"] = "Kailash Walk"
        # The session's own real watch-reported stats win over the GPS-derived ones.
        if s.get("when") is not None:
            activity["startTime"] = s["when"]
        if s.get("distance_m") is not None:
            activity["distanceMeters"] = s["distance_m"]
        if s.get("duration_s") is not None:
            activity["durationSeconds"] = s["duration_s"]
        activities.append(activity)
    return activities


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
    ap.add_argument("--json", action="store_true",
                     help="print one JSON activity object instead of human-readable lines - "
                          "for ambitapp-v2/backend/server.py, not meant for a person to read")
    args = ap.parse_args()

    sessions = None
    if args.from_file:
        with open(args.from_file, "rb") as f:
            data = f.read()
    else:
        from write_nav import Link, read_flash
        link = Link(dry_run=False, verbose=not args.json)
        if not args.json:
            print("read-only: 0x0b17 reads flash, nothing is written")
        link.open()
        data = read_flash(link, TRACKLOG_BASE, TRACKLOG_SIZE, label="TrackLog")
        if args.save:
            with open(args.save, "wb") as f:
                f.write(data)
            if not args.json:
                print(f"\nsaved raw dump to {args.save}")
        # Real, 2026-08-09: reuses the same already-open `link` for the DeviceHistory query
        # (0x1200, see kailash_history.py) needed to correlate real sessions against these
        # TrackLog points - no second USB open/close round trip. Not fatal if it fails (a
        # decode hiccup here shouldn't take down TrackLog reading, which is the whole point
        # of this tool) - falls back to the bundled-everything activity in that case.
        import kailash_history
        try:
            history = kailash_history.read_history(link, warn=lambda *_a, **_k: None)
            if history.get("ok"):
                sessions = history.get("sessions")
        except Exception:
            sessions = None

    points = list(walk_records(data))

    if args.json:
        activities = split_into_activities(points, sessions)
        print(json.dumps({"ok": True, "activities": activities} if activities
                          else {"ok": False, "error": "no real-looking points found"}))
        return 0 if activities else 1

    print(f"{len(points)} real-looking GPS record(s) found")
    for p in points[:20]:
        print(f"  [{p['index']:5}] {p['year']:04d}-{p['month']:02d}-{p['day']:02d} "
              f"{p['hour']:02d}:{p['minute']:02d}  lat={p['lat']:.5f} lon={p['lon']:.5f}  "
              f"third_raw={p['third_raw']}  trailer={p['trailer'].hex()}")
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
