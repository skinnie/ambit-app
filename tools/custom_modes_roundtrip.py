#!/usr/bin/env python3
"""Byte-exact round-trip check for the CustomModes region, against real SuuntoLink writes.

Before this project writes a STRUCTURAL change to CustomModes (adding or removing a display,
changing a display's type, editing a row), it has to be able to reproduce an UNMODIFIED
region byte-for-byte first. If `build_custom_modes_body(decode(x))` is not exactly `x`, then
any edit we make also carries whatever the encoder gets wrong - silently, into the one flash
region where a bad write makes a sport mode unusable on the watch.

This is the same standard the settings work met (140+ captured SuuntoLink 0x1101 writes
reproduced byte-exact before the first real write), applied to CustomModes.

The corpus is every CustomModes region image SuuntoLink itself wrote in a capture: each run
of 0x0b16 data writes into the region, closed by its 0x0b18 tail. `running2fromcreateandthen1to7`
alone carries 111 of them - one per save during a session that created a sport mode and then
added, removed, retyped and re-rowed its displays.

    ./tools/custom_modes_roundtrip.py                       # every capture that has any
    ./tools/custom_modes_roundtrip.py CAPTURE [CAPTURE ...] # just these
    ./tools/custom_modes_roundtrip.py --verbose             # show the first differing byte
"""

import argparse
import glob
import os
import sys

import ambit_format as F
import custom_modes
import custom_modes_write
from ambit_pcap import messages

CMD_DATA_WRITE = 0x0B16
CMD_DATA_TAIL = 0x0B18


def region_images(path):
    """Every complete CustomModes region image written in `path`, in capture order.

    One image per save: SuuntoLink rewrites the whole region and closes it with a 0x0b18
    tail, so a tail is the boundary. Bytes never written inside an image are 0xff, matching
    erased flash (the same convention FlashImage.read uses when hashing)."""
    lo = F.CUSTOM_MODES_BASE
    hi = lo + F.CUSTOM_MODES_REGION_SIZE
    out = []
    pending = []
    for m in messages(path):
        if m.incoming:
            continue
        if m.command == CMD_DATA_WRITE and len(m.payload) >= 8:
            addr = int.from_bytes(m.payload[:4], "little")
            length = int.from_bytes(m.payload[4:6], "little")
            if lo <= addr < hi:
                pending.append((addr, m.payload[8:8 + length]))
        elif m.command == CMD_DATA_TAIL and len(m.payload) >= 4:
            addr = int.from_bytes(m.payload[:4], "little")
            if lo <= addr < hi and pending:
                img = {}
                for a, body in pending:
                    for i, b in enumerate(body):
                        img[a + i] = b
                start, end = min(img), max(img)
                out.append(bytes(img.get(start + i, 0xFF) for i in range(end - start + 1)))
                pending = []
    return out


def check(path, verbose=False):
    """(matched, total, first_failure_note) for one capture."""
    images = region_images(path)
    matched = 0
    note = None
    for n, blob in enumerate(images):
        try:
            decoded = custom_modes.decode(blob)
            rebuilt = custom_modes_write.build_custom_modes_body(
                decoded, format_type=decoded.get("format_type", 2))
        except Exception as exc:                       # noqa: BLE001 - report, never mask
            if note is None:
                note = f"save {n}: {type(exc).__name__}: {exc}"
            continue
        # The region image is the body followed by erased padding; compare only as far as
        # the encoder claims to produce, then require the remainder to be untouched flash.
        head = blob[:len(rebuilt)]
        tail_is_blank = all(b == 0xFF for b in blob[len(rebuilt):])
        if head == rebuilt and tail_is_blank:
            matched += 1
        elif note is None:
            if len(rebuilt) != len(blob):
                note = (f"save {n}: rebuilt {len(rebuilt)} bytes against "
                        f"{len(blob)} in the capture"
                        + ("" if tail_is_blank else "; trailing bytes are not 0xff"))
            for i, (a, b) in enumerate(zip(head, rebuilt)):
                if a != b:
                    note = (note or "") + f"; first differing byte at {i}: " \
                                           f"capture {a:#04x}, rebuilt {b:#04x}"
                    break
    return matched, len(images), note


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("captures", nargs="*", help="capture files (default: every one in assets/pcap)")
    ap.add_argument("--verbose", action="store_true", help="show the first failure per capture")
    args = ap.parse_args()

    paths = args.captures or sorted(
        p for p in glob.glob(os.path.join(os.path.dirname(__file__), "..", "assets", "pcap", "*"))
        if os.path.isfile(p))

    total = ok = files = 0
    for p in paths:
        try:
            matched, count, note = check(p, args.verbose)
        except Exception:                              # not a readable capture - skip quietly
            continue
        if not count:
            continue
        files += 1
        total += count
        ok += matched
        flag = "OK   " if matched == count else "FAIL "
        print(f"  {flag} {os.path.basename(p)[:52]:52} {matched}/{count}")
        if note and matched != count:
            print(f"        {note}")

    print(f"\n{ok}/{total} CustomModes region images from {files} capture(s) "
          f"rebuilt byte-exact")
    return 0 if ok == total and total else 1


if __name__ == "__main__":
    sys.exit(main())
