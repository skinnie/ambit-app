#!/usr/bin/env python3
"""EXPERIMENTAL - writes one TrainingProgram item to the Ambit3's dedicated (and, on this
project's reference watch, otherwise empty) TrainingProgram flash region. DRY-RUN BY
DEFAULT: without --write nothing is emitted, only the exact bytes are logged.

See training_program_andre.md for the full derivation and, importantly, its honesty about
what isn't confirmed: unlike every other write tool in this project (sgee.py, write_nav.py's
route/reset/restore), this format has NO real capture anywhere in this project's assets to
verify against, and openambit/opensportsync's libambit has no read/write for it either. It
was built from decompiled-source structural analysis alone (cross-confirmed from two
independent code paths in TrainingProgramAreaConverter, so the 12-byte-header + 40-byte-item
shape is solid) - --write sends a real, unverified guess to real hardware. A 2026-08-05
test-write did land correctly (read back byte-exact), but there is no known way yet to
confirm the watch's firmware does anything with it - no Training menu exists anywhere in the
Ambit3 Peak's own user guide.

    # Path (1) re-test: one planned move dated TODAY, then check the watch's reminder/day
    # screen (NOT the WORKOUT menu - that's the separate Workout-Planner/guidance path).
    ./tools/training_program.py --name "Long run" --duration 60 --intensity 3   # dry-run
    ./tools/training_program.py --name "Long run" --duration 60 --write         # real write
    ./tools/training_program.py --name "Long run" --date 2026-08-20 --write     # dated tomorrow

Shares the low-level watch transport (`Link`, `send_plan`, the memory-map check) with
`write_nav.py` by importing it, the same way `custom_modes.py`/`apps.py`/`exercise_log.py`
do - not by being folded into `write_nav.py` itself, which is specifically for the
navigation database (routes/waypoints/POIs).
"""

import argparse
import datetime
import struct
import sys

import ambit_format as F
from ambit_pcap import FlashImage
from write_nav import CMD_DEVICE_INFO, Link, check_memory_map, read_memory_map, send_plan

# The first 8 header bytes looked hash/version-derived in the decompile and are NOT
# reproduced here - left zero, the least-committal guess. The closing hash MODE (whole-region
# vs written-only, see F.HASH_PADDED/HASH_WRITTEN) isn't confirmed either; WRITTEN is used
# since this format is self-describing via its own item count, the same shape as GpsSGEE's
# length-prefixed blob, unlike Routes/Waypoints' fixed-size database.
TRAINING_ITEM_SIZE = 40


def build_training_item(activity_id, duration_minutes, intensity, name,
                         day_offset=0, completed=False, move_id=0, distance=0):
    """One 40-byte TrainingProgram item. Layout REFINED 2026-08-09 (training_program_andre.md
    Finding 29) from a closer read of TrainingProgramAreaConverter::createBinary/parse in the
    decompiled backend - medium-high confidence, still not byte-verified against a real capture
    (none exists; Movescount is dead):

        off 0  u8   day_offset from the header's base date (parse multiplies it by 24h). This
                    is the real scheduling model - a move's date = base_date + day_offset days.
                    0 is VALID (the earliest/only move IS the base date). This corrects the
                    earlier "start_time byte, 0 is invalid" reading (Finding 24): what the real
                    client rejects with "no valid start time" is the JSON startTime that feeds
                    the HEADER base date, not this per-item byte.
        off 1  u8   completed (0/1)
        off 2  u16  activityId
        off 4  u32  moveId
        off 8  u32  distance (metres)
        off 12 u16  duration (MINUTES - createBinary divides JSON seconds by 60)
        off 14 u8   intensity (1-5)
        off 15 u8   padding (0)
        off 16 23B  activityName (ISO-8859, null-padded/truncated - strncpy 0x17). NOTE: starts
                    at offset 16, not 15 as the earlier version had it.
        off 39 u8   padding (0)
    """
    name_field = name.encode("iso-8859-15", "replace")[:23]
    name_field += b"\0" * (23 - len(name_field))
    item = struct.pack("<BBHIIHB", day_offset & 0xFF, int(completed), activity_id, move_id,
                        distance, duration_minutes, intensity & 0xFF)  # 15 bytes, off 0..14
    item += b"\0"          # off 15 padding
    item += name_field     # off 16..38
    item += b"\0" * (TRAINING_ITEM_SIZE - len(item))  # off 39 padding
    assert len(item) == TRAINING_ITEM_SIZE, len(item)
    return item


def build_training_program(items, base_date):
    """items: a list of build_training_item() results. See the EXPERIMENTAL notice above.

    HEADER (12 bytes) - base-date packing DECODED (Finding 59, 2026-08-13, from
    TrainingProgramAreaConverter::createBinary's FUN_00531d20 JDN->Gregorian converter),
    which closed this format's last unknown:

        off 0  u16  year   (little-endian)
        off 2  u8   month  (1-12)
        off 3  u8   day    (1-31)
        off 4  u32  = 0xFFFFFFFF for a fresh region (holds the prior binary's first 4 bytes
                    otherwise; the empty/sentinel value is all-ones)
        off 8  u16  item count
        off 10 u16  = 0xFFFF

    `base_date` (a datetime.date) is the reference date every item's day_offset counts from -
    the earliest move's date. Earlier writes packed seconds/hours-since-epoch here, producing a
    garbage date, which is why nothing surfaced (Finding 59). For the Path (1) re-test we pack a
    real calendar date so the watch can match "today"."""
    header = struct.pack("<HBBIHH", base_date.year, base_date.month, base_date.day,
                         0xFFFFFFFF, len(items), 0xFFFF)
    blob = header + b"".join(items)
    flash = FlashImage()
    flash.write(F.TRAINING_PROGRAM_BASE, blob)
    layout = [("TrainingProgram data", F.TRAINING_PROGRAM_BASE, blob),
              ("tail", F.TRAINING_PROGRAM_BASE, None)]
    return flash, layout


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--name", default="Test", help="the workout's name (up to 23 characters)")
    ap.add_argument("--duration", type=int, default=30, help="planned duration in minutes")
    ap.add_argument("--intensity", type=int, default=3, help="planned intensity, 0-255")
    ap.add_argument("--activity-id", type=int, default=3,
                     help="ActivityID (default 3 = Running)")
    ap.add_argument("--day-offset", type=int, default=0,
                     help="days from the header base date (0 = the base/earliest move itself);"
                          " see build_training_item()'s docstring (Finding 29)")
    ap.add_argument("--date", type=datetime.date.fromisoformat, default=datetime.date.today(),
                     help="header base date, YYYY-MM-DD (default: today). The move's real date"
                          " is this + --day-offset days. Path (1) re-test wants it to land on"
                          " today so the watch fires a training-day reminder.")
    ap.add_argument("--clear", action="store_true",
                     help="restore the region to its pristine empty state (all-0xFF, byte-"
                          "identical to a never-written region) instead of writing a move -"
                          " use with --write to undo a re-test afterwards")
    ap.add_argument("--write", action="store_true",
                     help="actually emits; without this option nothing is sent")
    ap.add_argument("--verbose", action="store_true", help="logs every 64-byte report")
    args = ap.parse_args()

    link = Link(dry_run=not args.write, verbose=args.verbose)
    if args.write:
        print("!! REAL WRITE requested (EXPERIMENTAL, unverified format - see"
              " training_program_andre.md)")
        link.open()
    else:
        print("dry-run mode: not a byte will be emitted")

    link.command(CMD_DEVICE_INFO, b"\x02\x48\x03\x00")
    check_memory_map(read_memory_map(link))

    if args.clear:
        blob = b"\xff" * F.TRAINING_PROGRAM_REGION_SIZE
        flash = FlashImage()
        flash.write(F.TRAINING_PROGRAM_BASE, blob)
        layout = [("TrainingProgram (cleared to empty)", F.TRAINING_PROGRAM_BASE, blob),
                  ("tail", F.TRAINING_PROGRAM_BASE, None)]
        print(f"  CLEAR: restoring {len(blob)} bytes of 0xFF (pristine empty region)")
    else:
        item = build_training_item(args.activity_id, args.duration, args.intensity, args.name,
                                    day_offset=args.day_offset)
        flash, layout = build_training_program([item], base_date=args.date)
        move_date = args.date + datetime.timedelta(days=args.day_offset)
        print(f"  header base date: {args.date.isoformat()} "
              f"(packed {args.date.year:#06x} {args.date.month:02d} {args.date.day:02d})")
        print(f"  item: name={args.name!r} activityId={args.activity_id} "
              f"duration={args.duration}min intensity={args.intensity} "
              f"-> move date {move_date.isoformat()}")
    send_plan(link, flash, layout, commit=False)

    total = sum(len(payload) for _, payload, _ in link.sent)
    reports = sum(len(r) for _, _, r in link.sent)
    print(f"\n{len(link.sent)} messages, {total} payload bytes, "
          f"{reports} reports of 64 bytes"
          + ("" if args.write else " — nothing was emitted"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
