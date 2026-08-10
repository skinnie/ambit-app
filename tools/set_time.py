#!/usr/bin/env python3
"""Writes the current local date/time to a connected Ambit-family watch.

Direct port of the already-working openambit/libambit implementation this whole project's
own C driver already carries unmodified (device_driver_common.c's
libambit_device_driver_date_time_set(), itself the real MovesLink-confirmed protocol - see
that file's own byte-for-byte comments) - not re-derived here, just re-expressed for the
Python/HID transport this project's desktop backend uses (write_nav.py's own Link class).

Real, 2026-08-10 ("I connected the kailash via usb... it didn't sync time... is this
function implemented in our app? if not implement it"): neither desktop nor Android had
this wired to anything before tonight, even though the underlying protocol logic already
existed. Two plain commands, no flash/PMEM involved, no known way for a malformed write
here to damage anything worse than a wrong clock - DRY-RUN BY DEFAULT anyway, matching
every other real write in this project's own tools/, not because this one is unusually
risky.

**Kailash is a real, separate case, found the same night** ("still doesn't take effect on
kailash") and worked out over several rounds of real evidence, the last of which
overturned the second-to-last: the raw 0x0300/0x0302 command pair above gets ack'd by a
normally-running Kailash but never actually changes its clock (confirmed live, 2026-08-10:
"I connected the kailash via usb... it didn't sync time"). A first hypothesis (built from
assets/pcap/resumefirmwarekailash) blamed this on cable time-sync needing bootloader mode -
wrong, per real correction ("kaylash doesn't flash firmware via 7r app and the app syncs
time by bluetooth to the watch"). A second hypothesis (built from SuuntoLink's own log
showing `NspEndDevice::setSmlData` right before `EmuDevice::setDateAndTime succeeded`,
plus Kailash's schema confirming a `sml.DeviceSettings.Time.TimeISO8601` field) guessed
this went through the generic 0x1101 whole-blob settings-write mechanism - also wrong: live
testing showed that field never even appears in a normal 0x1100 settings read, on either
transport, so there's no existing blob entry to patch.

The REAL mechanism, found byte-exact across five separate real 7R-app BLE captures and
then CONFIRMED IDENTICAL over cable in a real SuuntoLink capture
(assets/pcap/kailashsynctimefrom12178july2024to10820261618, "sync time" menu, ~2s,
matching what André saw live - no bootloader, no settings blob): a single-entry SBEM0102
push sent via command 0x1201 (the same opcode "log_synced" ambit3_log_synced.c's own
comment names, reused here for a single-entry push of a different field) - entry 0x34,
a utf8 ISO8601 string *with* timezone offset (`"%Y-%m-%dT%H:%M:%S%z"`, e.g.
"2026-08-08T17:20:22+0200"), NUL-terminated. This is what build_kailash_time_push() below
builds; see device_driver_ambit3.c's own kailash_time_sync() for the Android/native
mirror of this same real mechanism (same wire format, same evidence).

    ./tools/set_time.py            # dry-run: shows the exact bytes, sends nothing
    ./tools/set_time.py --write    # actually sets the watch's clock to this device's now
    ./tools/set_time.py --write --timezone "Europe/Paris"   # now, in a different timezone
    ./tools/set_time.py --write --json

Real, 2026-08-10 ("a button to sync time... opens a menu 'from device' 'from different
timezone'"): --timezone uses Python's own bundled zoneinfo (the real IANA tz database,
already shipped with the interpreter on every platform this project targets) - no network
fetch, no separate data file to maintain offline, and it's the same source
desktop/backend/server.py's own /api/time/zones endpoint lists names from.
"""

import argparse
import json
import struct
import sys
from datetime import datetime
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

CMD_TIME = 0x0300
CMD_DATE = 0x0302
CMD_KAILASH_TIME_PUSH = 0x1201  # "log_synced" opcode, reused for single-entry pushes
KAILASH_PRODUCT_ID = 0x002A
SBEM0102_MAGIC = b"SBEM0102"
KAILASH_TIME_ENTRY_ID = 0x34  # sml.DeviceSettings.Time.TimeISO8601


def build_date_payload(dt):
    # device_driver_common.c's own date_data: year u16 LE, month, day, then a real,
    # still-unexplained 0x28000000 trailer MovesLink itself always sent - copied as-is,
    # not guessed at.
    return struct.pack("<HBB", dt.year, dt.month, dt.day) + bytes([0x28, 0x00, 0x00, 0x00])


def build_time_payload(dt):
    # time_data: year u16 LE, month, day, hour, minute, then milliseconds-of-second u16 LE
    # (dt.second * 1000, matching the C driver's own `1000*tm->tm_sec` exactly).
    return struct.pack("<HBBBBH", dt.year, dt.month, dt.day, dt.hour, dt.minute, dt.second * 1000)


def build_kailash_time_push(dt):
    """The real command 0x1201 payload: 6-byte prefix (00 00 00 00 01 00, matching
    sbem0102.c's own libambit_sbem0102_command_request() header byte-for-byte) + the
    SBEM0102 magic + one entry (id 0x34, length, NUL-terminated ISO8601-with-offset
    string) - see this file's own docstring for the evidence."""
    encoded = dt.strftime("%Y-%m-%dT%H:%M:%S%z").encode("ascii") + b"\x00"
    if len(encoded) >= 0xFF:
        raise ValueError(f"ISO8601 string unexpectedly long ({len(encoded)} bytes)")
    return bytes([0, 0, 0, 0, 1, 0]) + SBEM0102_MAGIC + bytes([KAILASH_TIME_ENTRY_ID, len(encoded)]) + encoded


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--write", action="store_true", help="actually send it (default: dry-run)")
    ap.add_argument("--timezone", metavar="IANA_NAME",
                     help="use this timezone's current time instead of the local device's own")
    ap.add_argument("--json", action="store_true", help="print one JSON result line")
    args = ap.parse_args()

    if args.timezone:
        try:
            now = datetime.now(ZoneInfo(args.timezone))
        except ZoneInfoNotFoundError:
            msg = f"unknown timezone {args.timezone!r}"
            print(json.dumps({"ok": False, "error": msg}) if args.json else f"FAILED: {msg}")
            return 1
    else:
        # .astimezone() with no args attaches the system's own local tzinfo (offset
        # included) - needed for build_kailash_time_push()'s %z; datetime.now() alone
        # is naive and would render an empty offset.
        now = datetime.now().astimezone()
    date_payload = build_date_payload(now)
    time_payload = build_time_payload(now)

    if not args.write:
        if not args.json:
            print(f"dry-run: would set watch clock to {now.isoformat(timespec='seconds')}")
            print(f"  -> 0x{CMD_DATE:04x} {date_payload.hex(' ')}")
            print(f"  -> 0x{CMD_TIME:04x} {time_payload.hex(' ')}")
        else:
            print(json.dumps({"ok": True, "dry_run": True, "time": now.isoformat(timespec="seconds")}))
        return 0

    from write_nav import Link

    link = Link(dry_run=False, verbose=not args.json)
    if not args.json:
        print(f"setting watch clock to {now.isoformat(timespec='seconds')}")
    try:
        label = link.open()
        is_kailash = link.device is not None and "Kailash" in (label or "")
        if is_kailash:
            link.command(CMD_KAILASH_TIME_PUSH, build_kailash_time_push(now), quiet=args.json)
        else:
            link.command(CMD_DATE, date_payload, quiet=args.json)
            link.command(CMD_TIME, time_payload, quiet=args.json)
    except Exception as exc:
        if args.json:
            print(json.dumps({"ok": False, "error": str(exc)}))
        else:
            print(f"FAILED: {exc}")
        return 1

    if args.json:
        print(json.dumps({"ok": True, "dry_run": False, "time": now.isoformat(timespec="seconds")}))
    else:
        print("OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
