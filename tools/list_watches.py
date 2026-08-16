#!/usr/bin/env python3
"""List the Suunto watches currently on the USB bus.

Prints one JSON line: {"ok": true, "watches": [{"productId": int, "name": str,
"codename": str}]}. The desktop Home watch-switcher reads this to show "N watches
connected - tap to switch" (2026-08-16, porting the Android multi-watch picker), and to know
which product_id to hand /api/device/select so every subsequent tool targets that one watch.

Enumeration mirrors write_nav.Link.open()'s own hid.enumerate(VENDOR_ID, product_id) walk, so
the list is exactly the set of watches that Link could open - no more, no less.

    ./tools/list_watches.py
"""

import json

from write_nav import VENDOR_ID, PRODUCT_IDS, codename_for_pid


def list_watches():
    import hid  # imported lazily, same as Link.open()
    watches = []
    for pid, label in PRODUCT_IDS.items():
        if hid.enumerate(VENDOR_ID, pid):
            watches.append({"productId": pid, "name": label, "codename": codename_for_pid(pid)})
    return watches


def main():
    try:
        watches = list_watches()
    except Exception as exc:  # noqa: BLE001 - report, never mask
        print(json.dumps({"ok": False, "error": f"{type(exc).__name__}: {exc}", "watches": []}))
        return 1
    print(json.dumps({"ok": True, "watches": watches}))
    return 0


if __name__ == "__main__":
    import sys
    sys.exit(main())
