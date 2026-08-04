#!/usr/bin/env python3
"""Writes the navigation database to an Ambit3, reads its settings, or simulates.

DRY-RUN BY DEFAULT for the two actions that modify the watch: without --write
nothing is emitted, only the exact bytes are logged. A malformed body can reboot or
hang the watch.

    ./tools/write_nav.py reset
    ./tools/write_nav.py route GPX [GPX...] --meta CAPTURE
    ./tools/write_nav.py reset --write         # actually emits

    ./tools/write_nav.py settings              # READ-ONLY, needs the cable
    ./tools/write_nav.py settings --from CAPTURE   # decodes a capture, no watch

The GPX order is the descriptor order: most recently modified first.

The four values supplied by the application (distance, ascent, descent, timestamp)
are not in a GPX. --meta takes them from a capture; otherwise neutral values are
used, which remains to be validated on hardware.

`settings` never writes: it sends the 0x1100 query, four zero bytes, which is what
SuuntoLink sends on every connection, and decodes the reply. Its point is
WhitelistedBleDevices, the watch's BLE pairing bond, which is the first step of
milestone 7 in HANDOFF.md.
"""

import argparse
import pathlib
import sys

import ambit_format as F
from ambit_pcap import CMD_NAMES, FlashImage, encode_message, messages, write_packs
from build_route import emit_packs, route_from_gpx, serialize, stamp_from_capture

VENDOR_ID = 0x1493
PRODUCT_IDS = {
    0x001B: "Ambit3 Peak (Emu)", 0x001C: "Ambit3 Sport (Finch)",
    0x001E: "Ambit3 Run (Ibisbill)", 0x002C: "Ambit3 Vertical (Kaka)",
    0x002B: "Traverse (Jabiru)", 0x002D: "Traverse Alpha (Loon)",
}

CMD_DEVICE_INFO = 0x0000
CMD_SETTINGS_READ = 0x1100
CMD_MEMORY_MAP = 0x0B21
CMD_DATA_WRITE = 0x0B16
CMD_DATA_TAIL = 0x0B18
CMD_NAV_COMMIT = 0x0B04

# Entries of the DeviceSettings tree worth calling out, see tools/sbem_schema.py.
BLE_WHITELIST_ENTRY = 0x41
POD_ENTRY = 0x43

# Fields that are key material or identify a phone. --redact replaces their value with
# a length and a short digest: still enough to tell two reads apart or match them, not
# enough to use the key. Report a bond with --redact rather than retyping the values.
SECRET_FIELDS = ("MAC", "IdentityResolvingKey", "EncodingKey", "EncodingRnd")


def show_value(name, value, redacted):
    if not (redacted and value and name in SECRET_FIELDS):
        return repr(value)
    import hashlib
    text = str(value)
    return (f"<{len(text.split(':'))} bytes, "
            f"sha256:{hashlib.sha256(text.encode()).hexdigest()[:8]}>")


class Link:
    """HID transport. In dry-run no device is opened."""

    def __init__(self, dry_run=True, verbose=False):
        self.dry_run = dry_run
        self.verbose = verbose
        self.sequence = 0
        self.device = None
        self.sent = []

    def open(self):
        if self.dry_run:
            return None
        import hid  # imported only when actually writing

        for product_id, label in PRODUCT_IDS.items():
            for entry in hid.enumerate(VENDOR_ID, product_id):
                self.device = hid.Device(path=entry["path"])
                print(f"  watch: {label}")
                return label
        raise RuntimeError("no Ambit3 found on the USB bus")

    def command(self, command, payload=b"", expect_reply=True):
        reports = encode_message(command, payload, self.sequence)
        name = CMD_NAMES.get(command, f"0x{command:04x}")
        print(f"  {'[dry-run] ' if self.dry_run else ''}-> 0x{command:04x} "
              f"{name:22} {len(payload):5} B  {len(reports)} report(s)")
        if self.verbose:
            for report in reports:
                print(f"        {report.hex(' ')}")
        self.sent.append((command, payload, reports))
        self.sequence += 1
        if self.dry_run or not expect_reply:
            return b""
        for report in reports:
            self.device.write(report)
        return self._read_reply()

    def _read_reply(self):
        """Reassembles a reply, 42 payload bytes at +20 in the first report then 54 at
        +8. Loops on the announced total rather than on the part count of the header,
        as ambit_pcap.messages() does: a 0x1100 reply is 589 bytes over 12 reports."""
        import struct

        head = self.device.read(64, timeout=20000)
        if not head or head[0] != 0x3F:
            raise RuntimeError("no reply from the watch")
        total, = struct.unpack("<I", bytes(head[16:20]))
        body = bytes(head[20:20 + min(42, total)])
        while len(body) < total:
            more = self.device.read(64, timeout=20000)
            if not more:
                raise RuntimeError(f"truncated reply: {len(body)}/{total} bytes")
            body += bytes(more[8:8 + min(54, total - len(body))])
        return body


def settings_from_capture(capture):
    """The 0x1100 reply of a capture, for exercising the decoding without a watch."""
    for m in messages(capture):
        if m.command == CMD_SETTINGS_READ and m.incoming and m.payload:
            return m.payload
    raise ValueError(f"no 0x1100 reply in {capture}")


def show_settings(payload, show_all=False, redacted=False):
    """Decodes a 0x1100 reply through the SuuntoLink schema. Returns the list of BLE
    bonds carrying a key, or None when the schema is missing and the question cannot
    be answered. Never return an empty list in that case: an absent descriptor once
    read as "never paired" against a capture that did carry a bond."""
    import sbem_schema

    head = payload.find(sbem_schema.MAGIC)
    if head < 0:
        print("  no SBEM0102 payload in the reply")
        return None

    descriptor = sbem_schema.default_descriptor()
    if not descriptor.exists():
        print(f"  CANNOT DECIDE: the SuuntoLink descriptor is missing.\n"
              f"  Expected a descr+SERIAL+{sbem_schema.REFERENCE_FW} file in "
              f"{descriptor.parent}, whatever\n"
              f"  serial it carries; it comes from SuuntoLink's data folder. Without "
              f"it the entries\n  cannot be named, and this command cannot tell a "
              f"paired watch from an unpaired one.")
        for entry_id, data in sbem_schema.entries(payload[head:]):
            print(f"  0x{entry_id:02x} [{len(data)}] {data[:32].hex(' ')}")
        return None

    schema = sbem_schema.load(descriptor)
    entries = list(sbem_schema.entries(payload[head:]))
    print(f"  {len(entries)} entries in the DeviceSettings tree")

    bonds, slots = [], 0
    for entry_id, data in entries:
        if not (show_all or entry_id in (BLE_WHITELIST_ENTRY, POD_ENTRY)):
            continue
        print(f"  0x{entry_id:02x} {schema.label(entry_id) or '?'}  [{len(data)}]")
        for record in schema.decode_entry(entry_id, data) or []:
            fields = {schema.field_name(entry_id, f.fid): v for f, v in record}
            print("        " + "  ".join(f"{k}={show_value(k, v, redacted)}"
                                        for k, v in fields.items()))
            if entry_id != BLE_WHITELIST_ENTRY:
                continue
            slots += 1
            if fields.get("EncodingKey"):
                bonds.append(fields)

    if bonds:
        print(f"\n  {len(bonds)} BLE bond(s) carrying a key out of {slots} slot(s). "
              "The 16 bytes of\n  EncodingKey are the candidate for the NSP session "
              "token, see milestone 7\n  in HANDOFF.md.")
        if any(not b.get("IsNspCapable") for b in bonds):
            print("  Note: a bond has IsNspCapable=0. Observed on a pairing made "
                  "outside the\n  Suunto app; whether it gates the token is the open "
                  "question of milestone 7.")
        if redacted:
            print("  Key material is redacted, so this output is safe to send as is.")
        else:
            print("  These are real link keys. Re-run with --redact to get output that "
                  "is safe\n  to paste or send.")
    else:
        print(f"\n  {slots} whitelist slot(s), none carrying a key: this watch has no "
              "bond.\n  Pair it with a phone, then read again.")
    return bonds


def read_memory_map(link):
    """Addresses and sizes declared by the watch. In dry-run the reference values,
    the ones from the capture, are returned."""
    if link.dry_run:
        link.command(CMD_MEMORY_MAP, b"\0\0\0\0")
        return {name: (base, size) for base, (name, size, _) in F.REGIONS.items()}
    import re
    import struct

    reply = link.command(CMD_MEMORY_MAP, b"\0\0\0\0")
    found = {}
    for match in re.finditer(rb"(Waypoints|Routes|GpsSGEE)\x00", reply):
        cursor = match.end()
        end = reply.index(b"\0", cursor)          # hash in hexadecimal
        start, size = struct.unpack("<II", reply[end + 1:end + 9])
        found[match.group(1).decode()] = (start, size)
    return found


def check_memory_map(found):
    ok = True
    for base, (name, size, _) in F.REGIONS.items():
        if name not in found:
            continue
        start, declared = found[name]
        good = (start, declared) == (base, size)
        ok &= good
        print(f"  {'OK   ' if good else 'WARNING  '} {name:10} "
              f"0x{start:06x} size {declared}"
              + ("" if good else f"  (reference 0x{base:06x} / {size})"))
    return ok


def send_plan(link, flash, layout):
    for command, address, body in emit_packs(flash, layout):
        if command == CMD_DATA_WRITE:
            head = address.to_bytes(4, "little") + len(body).to_bytes(2, "little") \
                + b"\0\0"
            link.command(CMD_DATA_WRITE, head + body)
        else:
            # [u32 address][u32 supplied by the application] + 64 hex characters
            head = address.to_bytes(4, "little") + b"\0\0\0\0"
            link.command(CMD_DATA_TAIL, head + body)
    link.command(CMD_NAV_COMMIT)


def build_reset():
    flash = FlashImage()
    layout = [("waypoint header", F.WAYPOINT_BASE, F.WAYPOINT_HEADER_RESET),
              ("tail", F.WAYPOINT_BASE, None),
              ("route header", F.ROUTE_BASE, F.ROUTE_HEADER_RESET),
              ("tail", F.ROUTE_BASE, None)]
    for _, address, blob in layout:
        if blob:
            flash.write(address, blob)
    return flash, layout


def build_routes(gpx_paths, meta_capture):
    stamps = []
    if meta_capture:
        msgs = messages(meta_capture)
        reference = FlashImage(write_packs(msgs))
        stamps = [stamp_from_capture(reference, msgs, i)
                  for i in range(len(gpx_paths))]
    else:
        # Neutral values: the watch does not seem to validate them, but that is not
        # verified on hardware yet.
        stamps = [(0, 0, 0, (1, 1, 0, 0, 0, 0)) for _ in gpx_paths]
    routes = [route_from_gpx(path, *stamp) for path, stamp in zip(gpx_paths, stamps)]
    for route in routes:
        print(f"  route {route.name!r}: {len(route.points)} points, "
              f"{len(route.waypoints)} waypoint(s)")
    return serialize(routes)


def compare_with_capture(link, capture):
    """Compares the simulated 0x0b16 and 0x0b18 with those of the capture, payload by
    payload. Sequence numbers, which are session-specific, are out of the comparison:
    the HID framing is checked separately by hid_roundtrip.py."""
    expected = [(m.command, m.payload) for m in messages(capture)
                if not m.incoming and m.command in (CMD_DATA_WRITE, CMD_DATA_TAIL)]
    produced = [(command, payload) for command, payload, _ in link.sent
                if command in (CMD_DATA_WRITE, CMD_DATA_TAIL)]
    if len(produced) != len(expected):
        print(f"\n  FAIL  {len(produced)} messages produced against "
              f"{len(expected)} in the capture")
        return False
    ok = True
    for i, (got, want) in enumerate(zip(produced, expected)):
        if got[0] != want[0]:
            print(f"  FAIL  message {i}: 0x{got[0]:04x} against 0x{want[0]:04x}")
            ok = False
        elif got[1] != want[1]:
            ok = False
            # the second word of the 0x0b18 is supplied by the application, flag it
            differing = [k for k in range(min(len(got[1]), len(want[1])))
                         if got[1][k] != want[1][k]]
            only_extra = got[0] == CMD_DATA_TAIL and all(4 <= k < 8 for k in differing)
            print(f"  {'INFO ' if only_extra else 'FAIL '} message {i} "
                  f"0x{got[0]:04x}: bytes {differing[:8]}"
                  + ("  (word supplied by the application)" if only_extra else ""))
            if only_extra:
                ok = True
    print(f"\n  {'OK   ' if ok else 'FAIL '} {len(produced)} 0x0b16/0x0b18 payloads "
          f"compared to {capture}")
    return ok


def run_settings(args):
    """READ-ONLY: nothing is written to the watch, so there is no --write to give."""
    if args.from_capture:
        try:
            payload = settings_from_capture(args.from_capture)
        except ValueError as exc:
            print(f"  {exc}. Only ambit3full carries one.")
            return 1
        print(f"### {args.from_capture}, 0x1100 reply ({len(payload)} B)")
        return 0 if show_settings(payload, args.all, args.redact) is not None else 1

    link = Link(dry_run=False, verbose=args.verbose)
    print("read-only: the 0x1100 query, four zero bytes, nothing is written")
    link.open()
    payload = link.command(CMD_SETTINGS_READ, b"\0\0\0\0")
    print(f"  reply {len(payload)} B")
    return 0 if show_settings(payload, args.all, args.redact) is not None else 1


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=("reset", "route", "settings"))
    parser.add_argument("gpx", nargs="*")
    parser.add_argument("--write", action="store_true",
                        help="actually emits; without this option nothing is sent")
    parser.add_argument("--meta", metavar="CAPTURE",
                        help="takes distance, ascent, descent and timestamp from it")
    parser.add_argument("--compare", metavar="CAPTURE",
                        help="checks the simulated payloads against a capture")
    parser.add_argument("--from", metavar="CAPTURE", dest="from_capture",
                        help="settings: decodes a capture's 0x1100 instead of the watch")
    parser.add_argument("--all", action="store_true",
                        help="settings: every entry, not just the BLE bonds and pods")
    parser.add_argument("--redact", action="store_true",
                        help="settings: mask keys and MAC, output safe to send")
    parser.add_argument("--verbose", action="store_true",
                        help="logs every 64-byte report")
    args = parser.parse_args()

    if args.action == "route" and not args.gpx:
        parser.error("route expects at least one GPX")
    if args.action == "settings":
        if args.write:
            parser.error("settings is read-only, --write has nothing to write")
        return run_settings(args)
    if args.from_capture or args.all or args.redact:
        parser.error("--from, --all and --redact only apply to settings")

    link = Link(dry_run=not args.write, verbose=args.verbose)
    if args.write:
        print("!! REAL WRITE requested")
        link.open()
    else:
        print("dry-run mode: not a byte will be emitted")

    link.command(CMD_DEVICE_INFO, b"\x02\x48\x03\x00")
    check_memory_map(read_memory_map(link))

    if args.action == "reset":
        flash, layout = build_reset()
    else:
        flash, layout = build_routes([pathlib.Path(p) for p in args.gpx], args.meta)
    send_plan(link, flash, layout)

    total = sum(len(payload) for _, payload, _ in link.sent)
    reports = sum(len(r) for _, _, r in link.sent)
    print(f"\n{len(link.sent)} messages, {total} payload bytes, "
          f"{reports} reports of 64 bytes"
          + ("" if args.write else " — nothing was emitted"))
    if args.compare:
        return 0 if compare_with_capture(link, args.compare) else 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
