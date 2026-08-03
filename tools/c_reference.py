#!/usr/bin/env python3
"""Confronts the C serializer with the Python reference, itself validated against
the captures. Feeds csrc/build/harness with the routes rebuilt from the GPX files,
then demands identity of the writes and of both closing hashes.

    make -C csrc test
"""

import pathlib
import subprocess
import sys

import ambit_format as F
from ambit_pcap import FlashImage, messages, write_packs
from build_route import emit_packs, route_from_gpx, serialize, stamp_from_capture

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent
HARNESS = ROOT / "csrc" / "build" / "harness"
CAPTURES = ROOT / "assets" / "ambit3 pcap"

CASES = [
    ("route12km", ["Gare-du-Nord-to-114-Av.-André-Morizet.gpx"]),
    ("route128km", ["Grand-Tour-HDF---Partie-1---Lille-_-Arras.gpx",
                    "Gare-du-Nord-to-114-Av.-André-Morizet.gpx"]),
]


def fixture(routes):
    lines = []
    for route in routes:
        month, day, hour, minute, second, seconds = route.stamp
        lines.append(f"ROUTE {route.distance} {route.ascent} {route.descent} "
                     f"{seconds} {month} {day} {hour} {minute} {second} {route.name}")
        for lat, lon, ele in route.points:
            altitude = F.ALTITUDE_NONE if ele is None else int(ele)
            lines.append(f"POINT {round(lat * 1e7)} {round(lon * 1e7)} {altitude}")
        for lat, lon, name, point_index in route.waypoints:
            lines.append(f"WPT {round(lat * 1e7)} {round(lon * 1e7)} "
                         f"{point_index} {name}")
    return "\n".join(lines) + "\n"


def run_harness(payload):
    proc = subprocess.run([str(HARNESS)], input=payload, capture_output=True,
                          text=True)
    if proc.returncode != 0:
        raise RuntimeError(f"harness failed: {proc.stderr.strip()}")
    writes, hashes = [], {}
    for line in proc.stdout.splitlines():
        kind, *rest = line.split(" ")
        if kind == "W":
            writes.append((int(rest[0], 16), int(rest[1]), bytes.fromhex(rest[2])))
        elif kind == "H":
            hashes[rest[0]] = rest[1]
    return writes, hashes


def expected_from_python(capture, gpx_names):
    msgs = messages(CAPTURES / capture)
    reference = FlashImage(write_packs(msgs))
    routes = []
    for i, name in enumerate(gpx_names):
        routes.append(route_from_gpx(CAPTURES / name,
                                     *stamp_from_capture(reference, msgs, i)))
    built, layout = serialize(routes)
    writes, hashes = [], {}
    for command, address, body in emit_packs(built, layout):
        if command == 0x0B16:
            writes.append((address, len(body), body))
        else:
            key = "routes" if address == F.ROUTE_BASE else "waypoints"
            hashes[key] = body.decode("ascii")
    return routes, writes, hashes


def compare(capture, gpx_names):
    routes, want_writes, want_hashes = expected_from_python(capture, gpx_names)
    got_writes, got_hashes = run_harness(fixture(routes))
    ok = True

    if len(got_writes) != len(want_writes):
        print(f"  FAIL  {capture}: {len(got_writes)} C writes against "
              f"{len(want_writes)} expected")
        return False
    for i, (got, want) in enumerate(zip(got_writes, want_writes)):
        if got == want:
            continue
        ok = False
        print(f"  FAIL  {capture} write {i} @0x{want[0]:06x}:")
        if got[0] != want[0] or got[1] != want[1]:
            print(f"        C address/length 0x{got[0]:06x}/{got[1]} against "
                  f"0x{want[0]:06x}/{want[1]}")
        else:
            first = next(k for k in range(want[1]) if got[2][k] != want[2][k])
            print(f"        first difference at offset {first}: "
                  f"{got[2][first:first + 12].hex(' ')} against "
                  f"{want[2][first:first + 12].hex(' ')}")
    for key in ("waypoints", "routes"):
        if got_hashes.get(key) != want_hashes.get(key):
            ok = False
            print(f"  FAIL  {capture} hash {key}: {got_hashes.get(key)} against "
                  f"{want_hashes.get(key)}")
    # Direct comparison to the capture, so as not to depend on transitivity.
    msgs = messages(CAPTURES / capture)
    captured = [(a, l, b) for a, l, _, b in write_packs(msgs)]
    same_capture = got_writes == captured
    ok &= same_capture
    print(f"  {'OK   ' if same_capture else 'FAIL '} {capture}: C output "
          f"compared directly to the {len(captured)} 0x0b16 packets of the capture")

    if ok:
        total = sum(w[1] for w in want_writes)
        print(f"  OK    {capture}: {len(want_writes)} writes, {total} bytes, "
              f"2 hashes, identical to the Python reference")
    return ok


def compare_reset():
    writes, hashes = run_harness("RESET\n")
    expected = [(F.WAYPOINT_BASE, 6, F.WAYPOINT_HEADER_RESET),
                (F.ROUTE_BASE, 32, F.ROUTE_HEADER_RESET)]
    ok = writes == expected
    print(f"  {'OK   ' if ok else 'FAIL '} reset: two headers, "
          f"{'conforming' if ok else 'DIVERGENT'}")
    if not ok:
        for got, want in zip(writes, expected):
            if got != want:
                print(f"        C {got[2].hex(' ')}\n        expected {want[2].hex(' ')}")
    # The hash of an empty database must match the one from the routedelete captures
    for capture in ("routedelete", "poiimport"):
        msgs = messages(CAPTURES / capture)
        for address, _, digest in [(a, e, h) for a, e, h in
                                   __import__("ambit_pcap").tails(msgs)]:
            if address not in (F.ROUTE_BASE, F.WAYPOINT_BASE):
                continue
            key = "routes" if address == F.ROUTE_BASE else "waypoints"
            same = hashes.get(key) == digest
            ok &= same
            print(f"  {'OK   ' if same else 'FAIL '} hash {key} of the empty database "
                  f"against {capture}")
    return ok


def main():
    if not HARNESS.exists():
        print(f"harness missing: {HARNESS}. Run make -C csrc")
        return 2
    ok = compare_reset()
    for capture, gpx_names in CASES:
        ok &= compare(capture, gpx_names)
    print("\nC serializer conforms to the reference" if ok
          else "\nC serializer DIVERGENT")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
