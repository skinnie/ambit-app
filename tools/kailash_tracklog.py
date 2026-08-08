#!/usr/bin/env python3
"""Dumps the Suunto Kailash's `TrackLog` flash region and tries decoding it with this
project's own Ambit3 `ExerciseLog` parser, unmodified - a real hypothesis, not confirmed
against real bytes yet.

**Why this exists**: `kailash`'s own real `0x0b21` memory-map reply (`assets/ambit3 pcap/v2/
kailash`, decoded 2026-08-08, see `custom_modes_andre.md`'s "Kailash" section) reports no
`ExerciseLog` region at all (`start=0xffffffff, size=0`) - the Ambit3's own activity-log
mechanism plainly doesn't exist on this device. It does report a real, present `TrackLog`
region instead (`0x48a1c0`, 1,310,713 bytes - the largest real region on the device, the same
order of magnitude as Ambit3's own multi-megabyte `ExerciseLog`), never decoded before. André's
own real-world context: a later Suunto Traverse-generation watch line (Kailash/Hoopoe is part
of that same family) added on-watch activity recording after starting out as a places-visited
logger with no export mechanism of its own - consistent with "the data is really in there
somewhere, in *some* per-move format," even though nothing here has confirmed *which* format
yet.

**What this script actually does**: reads the real region byte-for-byte (`0x0b17`, the same
generic flash-read every other region in this project uses - Waypoints, Routes, GpsSGEE,
CustomModes, ExerciseLog, all go through the identical mechanism, so there's nothing
Kailash-specific about the read itself) and hands the raw bytes to `exercise_log.py`'s own
`parse_master_header()`/`walk_entries()`/`to_gpx()` - completely unmodified, just pointed at
`TRACKLOG_BASE`/`TRACKLOG_SIZE` instead of `EXERCISE_LOG_BASE`/`EXERCISE_LOG_SIZE`. If Kailash's
own on-watch recording reuses the same `libambit_pmem20_log_*` shape (plausible - it's the
same PMEM20 flash subsystem `pmem20.c` already documents for every other region on every
Ambit-family watch this project has looked at), this works with zero changes. If it doesn't,
`parse_master_header()`/`walk_entries()` are expected to raise or produce obvious garbage
(implausible dates, entry counts wildly larger than 1.3 MB could hold, etc.) rather than
silently succeed - this script reports exactly that rather than hiding it.

**Not yet run against a real Kailash** - no such device was connected while this was written.
Needs real hardware to actually confirm or refute the hypothesis.

    ./tools/kailash_tracklog.py --gpx-out /tmp/kailash_moves
    ./tools/kailash_tracklog.py --from /tmp/tracklog_dump.bin --gpx-out /tmp/kailash_moves
"""

import argparse
import struct
import sys

from exercise_log import parse_master_header, to_fit, to_gpx, walk_entries

# From the real kailash capture's own 0x0b21 memory-map reply, parsed directly (see
# custom_modes_andre.md's "Kailash" section for the full region table) - not guessed.
TRACKLOG_BASE = 0x48A1C0
TRACKLOG_SIZE = 1310713


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--from", dest="from_file", metavar="FILE",
                     help="decode a raw TrackLog dump instead of the watch")
    ap.add_argument("--save", metavar="FILE",
                     help="also save the raw region bytes here (live read only)")
    ap.add_argument("--gpx-out", metavar="DIR",
                     help="write one .gpx file per entry found into this directory")
    ap.add_argument("--fit-out", metavar="DIR",
                     help="write one .fit file per entry found into this directory")
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

    master = parse_master_header(data)
    print(f"master index (Ambit3-shaped read, unconfirmed for this device): "
          f"entries={master['entries']} first=0x{master['first_entry']:x} "
          f"last=0x{master['last_entry']:x} next_free=0x{master['next_free_address']:x}")
    if master["entries"] > TRACKLOG_SIZE // 32 or master["next_free_address"] > 0xFFFFFF:
        print("  WARNING: these numbers look implausible for a 1.3 MB region - the "
              "Ambit3 ExerciseLog header shape may not apply here. Treat anything below "
              "as unverified.")

    try:
        entries = list(walk_entries(data, mem_start=TRACKLOG_BASE, mem_size=TRACKLOG_SIZE))
    except (IndexError, struct.error, ValueError) as exc:
        print(f"\ncould not walk entries with the Ambit3 ExerciseLog format: {exc}")
        print("this is real, useful information: the hypothesis that TrackLog reuses "
              "ExerciseLog's own record shape is now falsified, not just unconfirmed - "
              "TrackLog needs its own format decode, not a reuse of this one.")
        return 1

    count = 0
    for header, samples in entries:
        count += 1
        print(f"\nentry {count}: {header['activity_name']!r} "
              f"{header['year']:04d}-{header['month']:02d}-{header['day']:02d} "
              f"{header['hour']:02d}:{header['minute']:02d}  "
              f"duration={header['duration_ms']/1000:.0f}s distance={header['distance']}m "
              f"samples={header['samples_count']} (parsed {len(samples)})")
        gps_samples = sum(1 for s in samples if s["type"] in
                           ("gps_base", "gps_small", "gps_tiny"))
        print(f"  {gps_samples} GPS-position sample(s)")
        if args.gpx_out:
            import os
            os.makedirs(args.gpx_out, exist_ok=True)
            path = os.path.join(args.gpx_out, f"move{count}.gpx")
            with open(path, "w") as f:
                f.write(to_gpx(header, samples))
            print(f"  wrote {path}")
        if args.fit_out:
            import os
            os.makedirs(args.fit_out, exist_ok=True)
            path = os.path.join(args.fit_out, f"move{count}.fit")
            try:
                fit_bytes = to_fit(header, samples)
            except ValueError as exc:
                print(f"  skipped FIT ({exc}), GPX above still has the metadata")
                continue
            with open(path, "wb") as f:
                f.write(fit_bytes)
            print(f"  wrote {path}")

    if count == 0:
        print("\nno entries found (empty logbook, or the format doesn't match - check the "
              "master-index warning above)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
