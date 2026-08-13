#!/usr/bin/env python3
"""GPS/GLONASS orbit (AGPS/SGEE) status over BLE, phone-driven, post-handshake.

Own file, this project's own "one file per format" convention. Reuses `sgee.py`'s own
`decode_orbit_head()`/`glonass_status()` unchanged - pure decode functions, transport-
agnostic already. The only thing not reused is `sgee.py`'s `run_status()` itself: it opens
with the same USB-specific `link.command(CMD_DEVICE_INFO, ...)` warm-up ping every other
BLE caller in this project has had to skip (see `ble_routes.py`'s own docstring for why -
no real BLE capture shows the phone re-requesting device info after the handshake, and it
has no proven reply over this transport).
"""

import sys

from sgee import CMD_GPS_ORBIT_HEAD, decode_orbit_head, glonass_status


def read_status(link):
    """Real 0x0b15 read, no network fetch, nothing written - the same query
    /api/agps/status and /api/agps/update's own offline fallback already make over USB."""
    head = link.command(CMD_GPS_ORBIT_HEAD, b"")
    status = decode_orbit_head(head)
    status["glonass"] = glonass_status(link)
    return status


def main():
    import argparse
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    args = ap.parse_args()  # noqa: F841 - no options yet, kept for --help consistency

    sys.path.insert(0, str(__import__("pathlib").Path(__file__).resolve().parent.parent
                           / "desktop" / "backend"))
    import ble_bridge                                        # noqa: PLC0415

    bridge = ble_bridge.BleBridge()
    status = bridge.status()
    if not status.get("handshake_done"):
        print("no BLE connection with a completed handshake - connect first")
        return 1
    bridge.set_dry_run(False)
    print(read_status(bridge))
    return 0


if __name__ == "__main__":
    sys.exit(main())
