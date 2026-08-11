#!/usr/bin/env python3
"""Generate the fake Garmin volume behind Testing mode's eTrex.

Real request, 2026-08-11 (André): "testing mode, opens a window and we can choose device,
based on all the characteristics we already know...always linked..and we add the garmin
etrex, that we also know the characteristics".

WHY A REAL FOLDER TREE, NOT A MOCK. A Garmin is not a protocol device in this app - it is a
USB mass-storage volume, and GarminService finds it by looking for `Garmin/GarminDevice.xml`
on every mounted volume, then resolving every path out of that XML. So the honest way to
simulate one is to build the actual folder tree on disk and point the service at it: the same
discovery, the same XML parse, the same GPX reader, the same SD-card write rule. Nothing in
the service is stubbed or bypassed, which is what makes Testing mode worth having - a bug in
any of that shows up here too.

WHAT IS REAL AND WHAT IS NOT. The XML structure, the model string, the SoftwareVersion
convention and the two GPSData paths are all copied from André's own eTrex 30 as recorded in
android/GARMIN_USB_IMPORT_SPEC.md - that is why the simulated device behaves like the real
one. The device Id and the GPS traces are NOT his: the real Current.gpx is a 160 KB recording
of where he actually went, and personal location data has no business in a fixture. The
tracks here are generated - a short loop in a public park - and the Id is a visible fake.

TWO VOLUMES ON PURPOSE. A real eTrex exposes internal memory and (when a card is in) the SD
card, and this app enforces a hard safety rule: writes go to the SD card only, never internal
memory. Testing mode ships both volumes so that rule is actually exercisable - you can try an
upload and watch it land on the card, which a single-volume fixture could never show.

    ./tools/gen_demo_garmin.py            # writes desktop/backend/demo_data/garmin/
    ./tools/gen_demo_garmin.py --check    # exit 1 if the tree is missing or stale
"""

import argparse
import math
import os
import sys

HERE = os.path.dirname(__file__)
OUT_DIR = os.path.join(HERE, "..", "desktop", "backend", "demo_data", "garmin")

# Structure, model string, version convention and both GPSData paths are the real eTrex 30's
# (GARMIN_USB_IMPORT_SPEC.md, confirmed against the hardware). Id is a visible fake.
DEVICE_XML = """<?xml version="1.0" encoding="UTF-8"?>
<Device xmlns="http://www.garmin.com/xmlschemas/GarminDevice/v2">
  <Model>
    <PartNumber>006-B1305-00</PartNumber>
    <SoftwareVersion>501</SoftwareVersion>
    <Description>eTrex 30</Description>
  </Model>
  <Id>0000000000</Id>
  <MassStorageMode>
    <DataType>
      <Name>GPSData</Name>
      <File>
        <Location>
          <Path>Garmin/GPX</Path>
        </Location>
        <TransferDirection>InputToUnit</TransferDirection>
      </File>
      <File>
        <Location>
          <Path>Garmin/GPX/Current</Path>
          <BaseName>Current</BaseName>
          <FileExtension>GPX</FileExtension>
        </Location>
        <TransferDirection>OutputFromUnit</TransferDirection>
      </File>
    </DataType>
  </MassStorageMode>
</Device>
"""

# Parque da Cidade, Porto - a public park, deliberately nowhere anyone lives.
CENTRE_LAT, CENTRE_LON = 41.1690, -8.6790


def _loop(points, radius_deg, start_iso, seconds_per_point, climb):
    """A closed loop of track points, with a plausible time and elevation profile."""
    out = []
    import datetime
    t0 = datetime.datetime.fromisoformat(start_iso)
    for i in range(points):
        angle = 2 * math.pi * i / points
        lat = CENTRE_LAT + radius_deg * math.sin(angle)
        # Longitude degrees are shorter than latitude degrees away from the equator; without
        # this the "loop" would be an ellipse on the map rather than the circle intended.
        lon = CENTRE_LON + radius_deg * math.cos(angle) / math.cos(math.radians(CENTRE_LAT))
        ele = 40 + climb * (1 - math.cos(angle)) / 2
        t = t0 + datetime.timedelta(seconds=i * seconds_per_point)
        out.append((lat, lon, ele, t.strftime("%Y-%m-%dT%H:%M:%SZ")))
    return out


def _track_gpx(name, pts):
    body = "".join(
        f'      <trkpt lat="{lat:.6f}" lon="{lon:.6f}">'
        f"<ele>{ele:.1f}</ele><time>{t}</time></trkpt>\n"
        for lat, lon, ele, t in pts)
    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1" creator="eTrex 30">\n'
        f"  <trk>\n    <name>{name}</name>\n    <trkseg>\n{body}"
        "    </trkseg>\n  </trk>\n</gpx>\n")


def _waypoints_gpx(points):
    body = "".join(
        f'  <wpt lat="{lat:.6f}" lon="{lon:.6f}"><ele>{ele:.1f}</ele>'
        f"<name>{name}</name><sym>Flag, Blue</sym></wpt>\n"
        for name, lat, lon, ele in points)
    # creator matches BaseCamp's real output, which is what put the waypoint files on the
    # real device - the app's reader is written against those, so the fixture matches them.
    return ('<?xml version="1.0" encoding="UTF-8"?>\n'
            '<gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1" '
            'creator="Garmin Desktop App">\n' + body + "</gpx>\n")


def build_files():
    files = {}
    # Only internal memory carries the device XML - that is how a real unit looks, and it is
    # exactly what the app's SD-card detection keys on, so the fixture must not "help" by
    # putting one on the card too.
    files["internal/Garmin/GarminDevice.xml"] = DEVICE_XML

    # The recorded track, where the device really puts it (GPSData OutputFromUnit).
    files["internal/Garmin/GPX/Current/Current.gpx"] = _track_gpx(
        "Morning walk", _loop(180, 0.0060, "2026-08-09T08:12:00", 12, 35))
    files["internal/Garmin/GPX/Current/Current_2026-08-02.gpx"] = _track_gpx(
        "Park loop", _loop(240, 0.0085, "2026-08-02T17:35:00", 9, 55))

    # Routes and waypoints live in the InputToUnit folder - what BaseCamp writes.
    files["internal/Garmin/GPX/Waypoints.gpx"] = _waypoints_gpx([
        ("Bandstand", 41.1702, -8.6772, 46.0),
        ("North gate", 41.1738, -8.6790, 52.0),
        ("Lake", 41.1665, -8.6825, 38.0),
    ])
    files["internal/Garmin/GPX/Route to the sea.gpx"] = _track_gpx(
        "Route to the sea", _loop(60, 0.0040, "2026-07-28T10:00:00", 20, 20))

    # The card starts empty - that is the realistic state, and it leaves somewhere for a
    # Testing-mode upload to actually appear.
    files["sdcard/Garmin/GPX/.keep"] = ""
    return files


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--check", action="store_true", help="fail if the tree is stale")
    args = ap.parse_args()

    out = os.path.normpath(OUT_DIR)
    files = build_files()

    if args.check:
        stale = [n for n, text in files.items()
                 if not os.path.exists(os.path.join(out, n))
                 or open(os.path.join(out, n)).read() != text]
        print("demo Garmin volume is up to date" if not stale
              else f"STALE: {', '.join(sorted(stale))} - re-run without --check")
        return 1 if stale else 0

    for name, text in files.items():
        path = os.path.join(out, name)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w") as fh:
            fh.write(text)
    print(f"wrote {os.path.relpath(out)}: {len(files)} files "
          f"(internal + sdcard volumes, eTrex 30)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
