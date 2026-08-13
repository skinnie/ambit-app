#!/usr/bin/env python3
"""POIs over BLE, phone-driven, post-handshake.

Own file, this project's own "one file per format" convention - see `ble_routes.py`'s own
docstring for the fuller explanation of that rule and of why no USB-specific warm-up ping
is sent here either.

Real gap, found live 2026-08-13 (André: "just check regarding POIs if they are following
what was used for USB...because I believe that last time they were not working also"):
unlike routes/settings/activities, `server.py`'s `_handle_pois_read`/`_handle_poi_add` had
NO BLE branch at all - they always ran `write_nav.py` over USB, so POIs never worked over
BLE despite everything else in this file's family having been ported. Reuses
`write_nav.py`'s own `read_pois`/`show_entries`/`build_poi_record`/`poi_write_payload_add`
unchanged - none of that logic is re-derived here, only assembled against a
`ble_bridge.BleBridge` instead of a USB `Link`.
"""

import contextlib
import io
import sys

from write_nav import (
    CMD_POI_WRITE, POI_ENTRY, build_poi_record, poi_write_payload_add, read_pois,
    show_entries,
)


def read_pois_summary(link):
    """The BLE path for GET /api/pois. `show_entries()` prints rather than returns, same
    as the USB path's `write_nav.py pois` output that `_handle_pois_read` already forwards
    as `raw_output` - captured here the same way so both transports render identically on
    the Routes/POIs page, which does its own regex parsing of that text."""
    reply = read_pois(link)
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        show_entries(reply, (POI_ENTRY,))
    return buf.getvalue()


def add_poi(link, name, lat, lon):
    """The BLE path for POST /api/pois - same algorithm as `write_nav.run_addpoi()`: read
    the whole list (0x0b24), rewrite it with the new record first (0x0b25). Never touches
    Waypoints/Routes flash and needs no commit. The read-before-write is load-bearing, same
    as the USB path - skipping it is what erased the POI store on 2026-08-04."""
    pois = read_pois(link)
    record = build_poi_record(name, lat, lon)
    payload = poi_write_payload_add(pois, record)
    link.command(CMD_POI_WRITE, payload)
    return {"ok": True, "dry_run": link.dry_run}


def main():
    import argparse
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--add", nargs=3, metavar=("NAME", "LAT", "LON"))
    ap.add_argument("--write", action="store_true",
                     help="actually emits over the already-connected ble_server.py daemon; "
                          "without this, a rehearsal only (nothing sent)")
    args = ap.parse_args()

    sys.path.insert(0, str(__import__("pathlib").Path(__file__).resolve().parent.parent
                           / "desktop" / "backend"))
    import ble_bridge                                        # noqa: PLC0415

    bridge = ble_bridge.BleBridge()
    status = bridge.status()
    if not status.get("handshake_done"):
        print("no BLE connection with a completed handshake - connect first")
        return 1
    bridge.set_dry_run(not args.write)

    if args.add:
        name, lat, lon = args.add
        result = add_poi(bridge, name, float(lat), float(lon))
        print(result)
        return 0 if result.get("ok") else 1

    print(read_pois_summary(bridge))
    return 0


if __name__ == "__main__":
    sys.exit(main())
