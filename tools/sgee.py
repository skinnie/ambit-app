#!/usr/bin/env python3
"""Writes GPS/GLONASS extended ephemeris (AGPS orbital data) to the Ambit3's GpsSGEE flash
region. DRY-RUN BY DEFAULT: without --write nothing is emitted, only the exact bytes are
logged. See sgee_andre.md for the full derivation and the live, unauthenticated data source
this was verified against on real hardware, 2026-08-05.

    ./tools/sgee.py gpsorbit.bin                          # simulates, nothing is emitted
    ./tools/sgee.py gpsorbit.bin --compare CAPTURE         # checks against a capture
    ./tools/sgee.py gpsorbit.bin --write                   # ACTUALLY EMITS

Shares the low-level watch transport (`Link`, `send_plan`, the memory-map check) with
`write_nav.py` by importing it, the same way `custom_modes.py`/`apps.py`/`exercise_log.py`
do - not by being folded into `write_nav.py` itself, which is specifically for the
navigation database (routes/waypoints/POIs).
"""

import argparse
import json
import pathlib
import sys

import ambit_format as F
from ambit_pcap import FlashImage, messages
from write_nav import (CMD_DATA_TAIL, CMD_DATA_WRITE, CMD_DEVICE_INFO, Link,
                        check_memory_map, read_memory_map, send_plan)

CMD_GPS_ORBIT_HEAD = 0x0B15


def decode_orbit_head(head):
    """[u8 valid][u16 LE year][u8 month][u8 day][u32 LE seconds-since-midnight UTC] - the
    watch's own currently-stored orbit-data generation date, confirmed against real
    hardware read-back (a fresh write followed by re-querying 0x0b15 reported back exactly
    the source file's own Last-Modified date). See sgee_andre.md Part 3 for the full
    derivation. `9x 0x00` (no fields set) is the real "no orbit data yet" reply, not an
    error - returned here as valid=False like any other unparseable reply."""
    if len(head) < 9 or head[0] != 1:
        return {"valid": False}
    year = int.from_bytes(head[1:3], "little")
    month, day = head[3], head[4]
    seconds = int.from_bytes(head[5:9], "little")
    if not (1 <= month <= 12 and 1 <= day <= 31 and seconds < 86400):
        return {"valid": False}
    return {
        "valid": True,
        "date": f"{year:04d}-{month:02d}-{day:02d}",
        "time": f"{seconds // 3600:02d}:{(seconds % 3600) // 60:02d}:{seconds % 60:02d}",
    }


def run_status(verbose):
    """Real, read-only device access (like exercise_log.py's own "read-only" mode) -
    dry_run=False so 0x0b15 actually reaches the watch, but nothing is ever written in this
    path; build_sgee()/send_plan() are never called here."""
    link = Link(dry_run=False, verbose=verbose)
    link.open()
    link.command(CMD_DEVICE_INFO, b"\x02\x48\x03\x00")
    head = link.command(CMD_GPS_ORBIT_HEAD, b"")
    return decode_orbit_head(head)


def build_sgee(path):
    """GPS/GLONASS extended ephemeris (AGPS), for a faster fix outdoors. Confirmed
    byte-exact against a real capture, 2026-08-05 (assets/ambit3 pcap/orbitsync): the wire
    format is a 4-byte little-endian length prefix followed by the raw ephemeris bytes,
    written at F.SGEE_BASE in the usual 1024-byte CMD_DATA_WRITE chunks, closed by one
    CMD_DATA_TAIL whose hash covers only the written bytes (F.region_hash's HASH_WRITTEN
    mode, already implemented and already used by this exact function via emit_packs()) -
    no CMD_NAV_COMMIT afterward, unlike Routes/Waypoints (see send_plan).

    `path` is a raw ephemeris file with no wrapper of its own - what SuuntoLink itself
    caches on disk (confirmed identical, byte for byte, to
    "assets/WIndows apps/Suuntolink/sgee.7d" against the capture above), not something
    this project can generate: it comes from Suunto's/a u-blox AGPS provider's live service,
    and goes stale after roughly one to a few weeks (the reason SuuntoLink bothers with the
    separate 0x0b15 freshness check at all - see the head bytes this action prints before
    writing). Point this at whatever fresh file you have; this function does not fetch one.
    """
    data = pathlib.Path(path).read_bytes()
    blob = len(data).to_bytes(4, "little") + data
    flash = FlashImage()
    flash.write(F.SGEE_BASE, blob)
    layout = [("GpsSGEE data", F.SGEE_BASE, blob), ("tail", F.SGEE_BASE, None)]
    return flash, layout


def compare_sgee_with_capture(link, capture):
    """Address-scoped rather than whole-capture: `orbitsync` is a full sync session
    (routes, POIs, logs and the SGEE write all mixed together), not an SGEE-only recording,
    so a message-count comparison over the whole capture does not apply - only messages
    whose own address falls inside the GpsSGEE region are pulled out and compared."""
    lo, hi = F.SGEE_BASE, F.SGEE_BASE + F.SGEE_REGION_SIZE

    def in_range(command, payload):
        if command not in (CMD_DATA_WRITE, CMD_DATA_TAIL) or len(payload) < 4:
            return False
        addr = int.from_bytes(payload[:4], "little")
        return lo <= addr < hi

    expected = [(m.command, m.payload) for m in messages(capture)
                if not m.incoming and in_range(m.command, m.payload)]
    produced = [(command, payload) for command, payload, _ in link.sent
                if in_range(command, payload)]
    if len(produced) != len(expected):
        print(f"\n  FAIL  {len(produced)} messages produced against "
              f"{len(expected)} in the capture's GpsSGEE range")
        return False
    ok = True
    for i, (got, want) in enumerate(zip(produced, expected)):
        if got[0] != want[0]:
            print(f"  FAIL  message {i}: 0x{got[0]:04x} against 0x{want[0]:04x}")
            ok = False
        elif got[1] != want[1]:
            ok = False
            differing = [k for k in range(min(len(got[1]), len(want[1])))
                         if got[1][k] != want[1][k]]
            only_extra = got[0] == CMD_DATA_TAIL and all(4 <= k < 8 for k in differing)
            print(f"  {'INFO ' if only_extra else 'FAIL '} message {i} "
                  f"0x{got[0]:04x}: bytes {differing[:8]}"
                  + ("  (word supplied by the application)" if only_extra else ""))
            if only_extra:
                ok = True
    print(f"\n  {'OK   ' if ok else 'FAIL '} {len(produced)} 0x0b16/0x0b18 payloads "
          f"compared to {capture}'s GpsSGEE range")
    return ok


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("file", nargs="?",
                     help="raw GPS/GLONASS ephemeris data, no wrapper of its own - not "
                          "needed with --status")
    ap.add_argument("--status", action="store_true",
                     help="just reads back the watch's current orbit-data date (0x0b15) "
                          "and exits - no file needed, nothing written")
    ap.add_argument("--json", action="store_true", help="machine-readable output for --status")
    ap.add_argument("--write", action="store_true",
                     help="actually emits; without this option nothing is sent")
    ap.add_argument("--compare", metavar="CAPTURE",
                     help="checks the simulated payloads against a capture")
    ap.add_argument("--verbose", action="store_true", help="logs every 64-byte report")
    args = ap.parse_args()

    if args.status:
        result = run_status(args.verbose)
        if args.json:
            print(json.dumps(result))
        elif result["valid"]:
            print(f"watch's current orbit data: {result['date']} {result['time']} UTC")
        else:
            print("watch has no valid orbit data (0x0b15 came back empty/unparseable)")
        return 0 if result["valid"] else 1

    if not args.file:
        ap.error("file is required unless --status is given")

    link = Link(dry_run=not args.write, verbose=args.verbose)
    if args.write:
        print("!! REAL WRITE requested")
        link.open()
    else:
        print("dry-run mode: not a byte will be emitted")

    link.command(CMD_DEVICE_INFO, b"\x02\x48\x03\x00")
    if not link.dry_run:
        head = link.command(CMD_GPS_ORBIT_HEAD, b"")
        print(f"  current orbit-data status (0x0b15, {len(head)} B): {head.hex()}"
              "  (structure decoded in sgee_andre.md)")
    check_memory_map(read_memory_map(link))

    flash, layout = build_sgee(args.file)
    send_plan(link, flash, layout, commit=False)

    total = sum(len(payload) for _, payload, _ in link.sent)
    reports = sum(len(r) for _, _, r in link.sent)
    print(f"\n{len(link.sent)} messages, {total} payload bytes, "
          f"{reports} reports of 64 bytes"
          + ("" if args.write else " — nothing was emitted"))
    if args.compare:
        return 0 if compare_sgee_with_capture(link, args.compare) else 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
