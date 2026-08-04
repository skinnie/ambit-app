#!/usr/bin/env python3
"""Non-regression: runs every capture through the decoder and both paired fixtures
through the regenerator. Non-zero exit on the first failure.

    ./tools/selftest.py
"""

import pathlib
import subprocess
import sys

HERE = pathlib.Path(__file__).resolve().parent
CAPTURES = HERE.parent / "assets" / "ambit3 pcap"

FIXTURES = [
    ("route12km", "Gare-du-Nord-to-114-Av.-André-Morizet.gpx", 0),
    ("route128km", "Grand-Tour-HDF---Partie-1---Lille-_-Arras.gpx", 0),
]

# Full rebuild from the GPX files alone, compared byte for byte. The GPX order is
# the capture's descriptor order, that is most recently modified first. `sync` and
# `ambit3full` are deliberately absent: there SuuntoLink computed the index's @12
# field over all the routes of the application, one of which was not enabled and was
# therefore not written. One byte diverges, and that application state is not
# derivable from a GPX.
BUILDS = [
    ("route12km", ["Gare-du-Nord-to-114-Av.-André-Morizet.gpx"]),
    ("route128km", ["Grand-Tour-HDF---Partie-1---Lille-_-Arras.gpx",
                    "Gare-du-Nord-to-114-Av.-André-Morizet.gpx"]),
]


def run(argv):
    proc = subprocess.run([sys.executable, *argv], capture_output=True, text=True)
    return proc.returncode == 0, proc.stdout + proc.stderr


def main():
    if not CAPTURES.is_dir():
        print(f"captures not found: {CAPTURES}")
        return 2

    checks, failures = 0, []

    def record(kind, label, argv):
        nonlocal checks
        ok, out = run([str(HERE / argv[0]), *argv[1:]])
        checks += 1
        print(f"  {'OK   ' if ok else 'FAIL '} {kind:7} {label}")
        if not ok:
            failures.append((label, out))

    captures = sorted(p for p in CAPTURES.iterdir()
                      if p.is_file() and p.suffix.lower() != ".gpx")
    for cap in captures:
        record("decode", cap.name, ["decode_route.py", str(cap)])

    for capture, gpx, route in FIXTURES:
        record("regen", f"{capture} + GPX",
               ["regen_route.py", str(CAPTURES / capture), "--route", str(route),
                "--from-gpx", str(CAPTURES / gpx)])

    for capture, gpxs in BUILDS:
        record("build", f"{capture} from {len(gpxs)} GPX",
               ["build_route.py", "--compare", str(CAPTURES / capture),
                *[str(CAPTURES / g) for g in gpxs]])

    record("hid", "frame encoder round trip", ["hid_roundtrip.py"])

    for label, argv in (
        # The bare form too: it takes the branch where there is neither a watch to read
        # the POIs from nor a capture to borrow them from, which once crashed.
        ("reset, bare dry-run", ["reset"]),
        ("reset against routedelete",
         ["reset", "--compare", str(CAPTURES / "routedelete")]),
        ("route against route12km",
         ["route", str(CAPTURES / "Gare-du-Nord-to-114-Av.-André-Morizet.gpx"),
          "--meta", str(CAPTURES / "route12km"),
          "--compare", str(CAPTURES / "route12km")]),
    ):
        record("dryrun", label, ["write_nav.py", *argv])

    if (HERE.parent / "csrc" / "build" / "harness").exists():
        record("C", "serializer against the reference", ["c_reference.py"])
    else:
        print("  skip    C serializer (run make -C csrc)")

    # Both need the SuuntoLink descriptor, and `settings` deliberately fails without
    # it rather than reporting an unpaired watch it cannot actually see.
    if any((HERE.parent / "assets").glob("descr+*+2.4.17")):
        record("schema", "SBEM payloads of the captures",
               ["sbem_schema.py", "--verify"])
        for action, capture in (("settings", "ambit3full"), ("pois", "poiimport"),
                                ("logbook", "poiimport"), ("nav", "route128km"),
                                ("nav", "routedelete")):
            record("dryrun", f"{action} read from {capture}",
                   ["write_nav.py", action, "--from", str(CAPTURES / capture)])
    else:
        print("  skip    SBEM schema and settings (SuuntoLink descriptor absent)")

    print(f"\n{checks - len(failures)}/{checks} checks pass")
    for name, out in failures:
        print(f"\n--- {name}\n{out}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
