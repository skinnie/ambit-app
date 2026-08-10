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
kailash", then real cross-referenced evidence in assets/pcap/*kailash* and
assets/WIndows apps/Suuntolink/suuntoapp*.log): the raw 0x0300/0x0302 command pair above
gets ack'd by a normally-running Kailash but never actually changes its clock - real
captures show it only ever taking effect while the watch is in its USB bootloader, which
this project's own standing rule puts off-limits to touch casually. The real, normal-mode
mechanism SuuntoLink itself uses is different: its own log shows
`NspEndDevice::setSmlData` firing immediately before a real `EmuDevice::setDateAndTime
succeeded`, and Kailash's own schema descriptor confirms
`sml.DeviceSettings.Time.TimeISO8601` (a real settings field, written through the same
0x1101 mechanism already confirmed live for Home Location/backlight/etc. - see
settings_write.py's own KAILASH_SETTINGS/write_one()). This tool detects Kailash by its
real product ID and uses that path instead, transparently - callers don't need to know
which watch is connected.

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
KAILASH_PRODUCT_ID = 0x002A


def build_date_payload(dt):
    # device_driver_common.c's own date_data: year u16 LE, month, day, then a real,
    # still-unexplained 0x28000000 trailer MovesLink itself always sent - copied as-is,
    # not guessed at.
    return struct.pack("<HBB", dt.year, dt.month, dt.day) + bytes([0x28, 0x00, 0x00, 0x00])


def build_time_payload(dt):
    # time_data: year u16 LE, month, day, hour, minute, then milliseconds-of-second u16 LE
    # (dt.second * 1000, matching the C driver's own `1000*tm->tm_sec` exactly).
    return struct.pack("<HBBBBH", dt.year, dt.month, dt.day, dt.hour, dt.minute, dt.second * 1000)


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
        now = datetime.now()
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
            import settings_write
            from write_nav import descriptor_for_product_id
            # Real bug, caught here before ever reaching hardware: passing descriptor=None
            # through to write_one() resolves via sbem_schema.load(None) ->
            # default_descriptor(), which globs for *Ambit3's* reference firmware (2.4.17) -
            # not Kailash's own schema. Exactly the bug descriptor_for_product_id()'s own
            # docstring already documents (found 2026-08-08 for show_settings()); must
            # resolve Kailash's real descriptor explicitly, same as settings_write.py's own
            # main() does.
            descriptor = descriptor_for_product_id(KAILASH_PRODUCT_ID)
            result = settings_write.write_one(
                link, descriptor, "device_time", now.strftime("%Y-%m-%dT%H:%M:%S"),
                product_id=KAILASH_PRODUCT_ID)
            if not result.get("ok"):
                raise RuntimeError(result.get("error") or f"write not confirmed: {result}")
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
