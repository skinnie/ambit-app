#!/usr/bin/env python3
"""Checks the HID frame encoder: re-encodes every outgoing message of the captures
and demands identity with the original 64-byte reports.

    ./tools/hid_roundtrip.py
"""

import pathlib
import struct
import sys

from ambit_pcap import encode_message, messages, outgoing_reports

CAPTURES = pathlib.Path(__file__).resolve().parent.parent / "assets" / "ambit3 pcap"


def check(path):
    outgoing = [m for m in messages(path) if not m.incoming]
    groups = outgoing_reports(path)
    if len(outgoing) != len(groups):
        print(f"  FAIL  {path.name}: {len(outgoing)} messages for "
              f"{len(groups)} report groups")
        return False, 0, 0
    diverging = 0
    for message, reports in zip(outgoing, groups):
        head = reports[0]
        sequence, = struct.unpack("<H", head[14:16])
        send_recv, fmt = struct.unpack("<HH", head[10:14])
        mine = encode_message(message.command, message.payload, sequence,
                              send_recv=send_recv, fmt=fmt)
        if mine != [bytes(r) for r in reports]:
            if diverging == 0:
                offsets = [i for i in range(64) if mine[0][i] != head[i]]
                print(f"  FAIL  {path.name}: 0x{message.command:04x} diverges at "
                      f"offsets {offsets[:8]}")
            diverging += 1
    total_reports = sum(len(g) for g in groups)
    print(f"  {'OK   ' if not diverging else 'FAIL '} {path.name:12} "
          f"{len(outgoing)} messages, {total_reports} reports"
          + (f", {diverging} diverging" if diverging else ""))
    return diverging == 0, len(outgoing), total_reports


def main():
    ok, messages_seen, reports_seen = True, 0, 0
    for path in sorted(CAPTURES.iterdir()):
        if not path.is_file() or path.suffix.lower() == ".gpx":
            continue
        good, n, r = check(path)
        ok &= good
        messages_seen += n
        reports_seen += r
    print(f"\n{messages_seen} messages and {reports_seen} reports of 64 bytes "
          f"{'re-encoded identically' if ok else 'WITH DIVERGENCES'}")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
