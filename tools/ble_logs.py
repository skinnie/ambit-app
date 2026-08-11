#!/usr/bin/env python3
"""Activity log headers over BLE, phone-driven, post-handshake (`ServerLink.DRIVER_FLAGS`).

Own file, not a branch in `ble_server.py` - this project's own "one file per format"
convention (new watch features get their own file importing what they need, never grow an
existing transport file into a feature dispatcher).

STATUS: the first request in the real sequence only - a summary/count query, not the full
per-activity page loop. Found the same way as `ble_server.py`'s `CMD_GET_COMPACT_SERIAL`:
decoding the real working Suunto app's own capture directly
(`assets/ble 2026-08-09/btsnoop_suuntoapp_2026-08-09.log`, tshark + `ble_server.py`'s own
SLIP/frame logic). The real post-handshake `0x1200` sequence in that capture is THREE
requests, not one:

    pkt=4  entry 0xec  ->  670-byte reply (this file's REQUEST/parse_summary_reply below)
    pkt=7  entry 0x8d, cursor 0x0000  ->  907-byte reply (real per-activity entries)
    pkt=8  entry 0x8d, cursor 0x0018  ->  898-byte reply
    pkt=9  entry 0x8d, cursor 0x0030  ->  608-byte reply

The cursor advances by 0x18 (24) each page in the capture, consistent with a fixed
per-page entry count, but nothing in the capture says what ends the sequence (a sentinel
reply, a count from the first 0xec reply, or something else) - guessing that wrong risks a
loop that never stops or one that stops early, silently short. Deliberately not
implemented here until that can be verified against a live watch; entry 0x8d's per-activity
byte layout also hasn't been cross-checked against exercise_log.py's own known field
offsets yet (date/duration/distance/sport type). Real, useful data point either way: the
"first request in the sequence" scope below IS real, tested plumbing, not a guess.

    ./tools/ble_logs.py summary   # over an already-connected ble_server.py daemon
"""

import argparse
import sys

from write_nav import CMD_LOG_HEADERS

# The real captured request for the FIRST 0x1200 in the post-handshake sequence (entry
# 0xec) - byte-exact reuse rather than reconstructed, same reasoning as
# ble_server.COMPACT_SERIAL_REQUEST: this specific entry id isn't write_nav.py's own
# LOGBOOK_REQUEST constant (that one is entry 0x8d, matching pkt=7-9 above, not pkt=4), and
# the capture is the only evidence of what this first query actually is.
LOG_SUMMARY_REQUEST = bytes.fromhex("0000000001000a005342454d30313032ec00")


def fetch_log_summary(link):
    """One real post-handshake request/reply - `link` is anything with `.command()`
    (`desktop/backend/ble_bridge.BleBridge`, or `ServerLink` directly). Returns the raw
    reply payload; parsing it is not yet done (see this file's own docstring)."""
    return link.command(CMD_LOG_HEADERS, LOG_SUMMARY_REQUEST)


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("action", choices=["summary"])
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()

    sys.path.insert(0, str(__import__("pathlib").Path(__file__).resolve().parent.parent
                           / "desktop" / "backend"))
    import ble_bridge                                        # noqa: PLC0415

    bridge = ble_bridge.BleBridge()
    status = bridge.status()
    if not status.get("handshake_done"):
        print("no BLE connection with a completed handshake - connect first "
              "(ble_server.py listen, or via the desktop app's /api/ble/connect)")
        return 1
    bridge.set_dry_run(False)
    reply = fetch_log_summary(bridge)
    if args.json:
        import json
        print(json.dumps({"payload_hex": reply.hex(), "len": len(reply)}))
    else:
        print(f"  {len(reply)} B reply")
        print(f"  {reply.hex()}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
