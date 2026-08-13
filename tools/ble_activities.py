#!/usr/bin/env python3
"""Recorded activities (ExerciseLog) over BLE, phone-driven, post-handshake.

Own file, this project's own "one file per format" convention. Unlike `ble_logs.py`
(this project's earlier, abandoned attempt at the real Suunto app's own phone-pull 0x1200
sequence - no known stop condition, never finished), `exercise_log.py`'s USB implementation
takes a much simpler route that turns out to need no BLE-specific work at all: it reads the
whole ExerciseLog region via plain 0x0b17 flash reads (`read_flash()`, the exact mechanism
already proven reliable over BLE for routes tonight - 146KB read clean, self-validating via
the region's own CRC) and decodes it locally. This file only replicates `exercise_log.py
main()`'s own watch-reading sequence (probe the real used size, read only that, walk the
entries) against a `link` instead of duplicating it inline - the actual sample/GPX/FIT
decode is 100% reused, unchanged.
"""

import struct
import sys

from exercise_log import (
    EXERCISE_LOG_BASE, EXERCISE_LOG_SIZE, parse_master_header, to_fit, to_gpx, walk_entries,
)
from write_nav import read_flash


def read_activities(link, known_count=0):
    """Returns (master, entries) - same shape `exercise_log.py main()`'s own watch-reading
    branch produces. `entries` is a list of (header, samples) tuples; pass each to
    `to_gpx()`/`to_fit()` for export, same as the USB CLI does."""
    probe = read_flash(link, EXERCISE_LOG_BASE, 1024, label="ExerciseLog (header)")
    probe_master = parse_master_header(probe)
    needed = probe_master["next_free_address"] - EXERCISE_LOG_BASE + 8192
    needed = max(1024, min(EXERCISE_LOG_SIZE, needed))
    data = read_flash(link, EXERCISE_LOG_BASE, needed, label="ExerciseLog")
    try:
        entries = list(walk_entries(data, skip_count=known_count))
    except (IndexError, struct.error):
        data = read_flash(link, EXERCISE_LOG_BASE, EXERCISE_LOG_SIZE, label="ExerciseLog")
        entries = list(walk_entries(data, skip_count=known_count))
    master = parse_master_header(data)
    return master, entries


def main():
    import argparse
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--known-count", type=int, default=0, metavar="N")
    args = ap.parse_args()

    sys.path.insert(0, str(__import__("pathlib").Path(__file__).resolve().parent.parent
                           / "desktop" / "backend"))
    import ble_bridge                                        # noqa: PLC0415

    bridge = ble_bridge.BleBridge()
    status = bridge.status()
    if not status.get("handshake_done"):
        print("no BLE connection with a completed handshake - connect first")
        return 1
    bridge.set_dry_run(False)
    master, entries = read_activities(bridge, args.known_count)
    print(f"master: entries={master['entries']}")
    for header, samples in entries:
        print(f"  {header['activity_name']!r} {header['year']:04d}-{header['month']:02d}-"
              f"{header['day']:02d}, {len(samples)} sample(s)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
