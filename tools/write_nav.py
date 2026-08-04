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
CMD_POI_READ = 0x0B24
CMD_POI_WRITE = 0x0B25
CMD_LOG_HEADERS = 0x1200
CMD_FLASH_READ = 0x0B17
FLASH_CHUNK = 1024

# 0x1200 asks for an object by identifier, unlike 0x1100 and 0x0b24 which take four zero
# bytes and return everything. Here: sml.DeviceLogBook, entry 0x8d, empty.
LOGBOOK_REQUEST = (bytes.fromhex("00000000") + (1).to_bytes(2, "little")
                   + (10).to_bytes(2, "little") + b"SBEM0102" + bytes([0x8D, 0x00]))

# The three read-only queries: command, request payload, and the entries worth printing
# when --all is not given.
QUERIES = {
    "settings": (CMD_SETTINGS_READ, b"\0\0\0\0", (0x41, 0x43)),
    "pois": (CMD_POI_READ, b"\0\0\0\0", (0x55,)),
    "logbook": (CMD_LOG_HEADERS, LOGBOOK_REQUEST, (0x59, 0x5A, 0x8A)),
}

POI_ENTRY = 0x55
# Prefix of an SBEM payload sent to the watch, as against 0x...0100 on a reply.
SBEM_WRITE_PREFIX = bytes.fromhex("000000000101")

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


def open_hid(hid, path):
    """Two different modules import as `hid`, both are packaged, and their APIs differ.

    PyPI `hid`, ctypes bindings, exposes `Device(path=...)`. cython-hidapi, which Debian
    and Mint ship as `python3-hid`, exposes `device()` plus `open_path()` and no `Device`
    at all. Accept either, so that a plain `apt install python3-hid` is enough and nobody
    has to be told which packaging to prefer.

    `enumerate()` is identical in both, and `read(size, timeout)` agrees as long as the
    timeout stays positional: the keyword is `timeout` in one and `timeout_ms` in the
    other. `read()` returns bytes in one and a list of ints in the other, which is why
    every slice of a reply is wrapped in `bytes()`.
    """
    if hasattr(hid, "Device"):
        return hid.Device(path=path)
    device = hid.device()
    device.open_path(path)
    return device


class Link:
    """HID transport. In dry-run no device is opened."""

    def __init__(self, dry_run=True, verbose=False):
        self.dry_run = dry_run
        self.verbose = verbose
        self.sequence = 0
        self.device = None
        self.sent = []

    def open(self):
        """Listing a USB device needs no privilege, opening its /dev/hidraw node does,
        so the two failures are told apart: nothing plugged in is not the same problem
        as a device present and unopenable, and only the second has a udev fix."""
        if self.dry_run:
            return None
        import hid  # imported only when a device is really opened

        found = [(entry, label) for product_id, label in PRODUCT_IDS.items()
                 for entry in hid.enumerate(VENDOR_ID, product_id)]
        if not found:
            raise RuntimeError(
                "no Ambit3 on the USB bus. Check the cable, then that `lsusb` lists a "
                "device whose id starts with 1493:")
        failures = []
        for entry, label in found:
            try:
                self.device = open_hid(hid, entry["path"])
            except Exception as exc:  # every backend raises its own type here
                failures.append(f"{entry['path']!r}: {exc}")
                continue
            print(f"  watch: {label}")
            return label
        raise RuntimeError(
            f"{len(found)} Ambit3 on the USB bus, none of them openable. This is almost "
            "always permissions on the\n  hidraw node rather than anything to do with "
            "the watch. Check with:\n"
            "    ls -l /dev/hidraw*\n"
            "  Grant access, then unplug and replug the watch:\n"
            "    echo 'SUBSYSTEM==\"hidraw\", ATTRS{idVendor}==\"1493\", MODE=\"0666\"'"
            " | sudo tee /etc/udev/rules.d/99-suunto.rules\n"
            "    sudo udevadm control --reload-rules\n"
            "  Having openambit installed does not settle this: a rule written for its "
            "own transport\n  covers a different device node than the one used here.\n"
            "  The backend said: " + "; ".join(failures))

    def command(self, command, payload=b"", expect_reply=True, quiet=False):
        reports = encode_message(command, payload, self.sequence)
        name = CMD_NAMES.get(command, f"0x{command:04x}")
        if not quiet:
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

        head = self.device.read(64, 20000)  # positional: see open_hid()
        if not head or head[0] != 0x3F:
            raise RuntimeError("no reply from the watch")
        total, = struct.unpack("<I", bytes(head[16:20]))
        body = bytes(head[20:20 + min(42, total)])
        while len(body) < total:
            more = self.device.read(64, 20000)
            if not more:
                raise RuntimeError(f"truncated reply: {len(body)}/{total} bytes")
            body += bytes(more[8:8 + min(54, total - len(body))])
        return body


def read_flash(link, address, size, label=""):
    """Reads a flash region through 0x0b17: [u32 address][u32 length] out, the same eight
    bytes then the data back, 1024 at a time as SuuntoLink does in `ambit3full`.

    This is the read path `HANDOFF.md` wanted for milestone 4 and never had. It is what
    makes a backup possible, and it is self-checking: the region carries its own CRC.
    """
    import struct

    out = b""
    while len(out) < size:
        want = min(FLASH_CHUNK, size - len(out))
        reply = link.command(CMD_FLASH_READ,
                             struct.pack("<II", address + len(out), want), quiet=True)
        if len(reply) < 8:
            raise RuntimeError(f"0x0b17 at 0x{address + len(out):06x}: short reply")
        got_address, got_size = struct.unpack("<II", reply[:8])
        if (got_address, got_size) != (address + len(out), want):
            raise RuntimeError(
                f"0x0b17 asked 0x{address + len(out):06x}/{want}, "
                f"got 0x{got_address:06x}/{got_size}")
        out += reply[8:8 + got_size]
        print(f"\r  {label} {len(out)}/{size} B", end="", flush=True)
    print()
    return out


def show_navigation(flash):
    """Decodes the navigation database read off the watch, with the structures the
    serializer already uses. The CRCs make the read self-validating: they cover the
    descriptors and the points, so if they match, the bytes came back intact."""
    header = F.RouteHeader.parse(flash.read(F.ROUTE_BASE, 32))
    waypoint_header = F.WaypointHeader.parse(flash.read(F.WAYPOINT_BASE, 6))
    routes, points = header.route_count, header.point_count
    print(f"  routes {routes}   points {points}   waypoints {waypoint_header.count}")

    if header.magic != F.ROUTE_HEADER_MAGIC:
        print(f"  !! route header magic 0x{header.magic:04x}, expected "
              f"0x{F.ROUTE_HEADER_MAGIC:04x}")
        return None

    descriptors = flash.read(F.ROUTE_DESC, 52 * routes)
    body = flash.read(F.ROUTE_POINTS, 12 * points)
    # An empty database carries a literal zero rather than the CRC of nothing, which is
    # what the reset plan writes and what routedelete shows.
    crc = F.crc16_ccitt_false(descriptors + body) if routes else 0
    wpt_blob = flash.read(F.WAYPOINT_DESC, 52 * waypoint_header.count)
    wpt_crc = F.crc16_ccitt_false(wpt_blob)
    print(f"  {'OK   ' if crc == header.checksum else 'FAIL '} route CRC "
          f"0x{crc:04x} against 0x{header.checksum:04x}"
          + ("  (empty database, a literal zero)" if not routes else ""))
    print(f"  {'OK   ' if wpt_crc == waypoint_header.checksum else 'FAIL '} waypoint CRC "
          f"0x{wpt_crc:04x} against 0x{waypoint_header.checksum:04x}")

    for i in range(routes):
        d = F.RouteDescriptor.parse(flash.read(F.ROUTE_DESC + 52 * i, 52))
        e = F.RouteIndexEntry.parse(flash.read(F.ROUTE_INDEX + 20 * i, 20))
        section = [F.RoutePoint.parse(flash.read(F.ROUTE_POINTS + 12 * k, 12))
                   for k in range(d.start_index, d.start_index + d.point_count)]
        alt = [q.altitude for q in section if q.altitude != F.ALTITUDE_NONE]
        print(f"  route[{i}] {d.name!r}  {d.point_count} points  {d.distance} m  "
              f"ascent {d.ascent} descent {d.descent}  waypoints {e.waypoint_count}")
        print(f"           altitude " + (f"{min(alt)} to {max(alt)} m on "
                                         f"{len(alt)}/{len(section)} points"
                                         if alt else "absent on every point"))
    for i in range(waypoint_header.count):
        w = F.WaypointDescriptor.parse(flash.read(F.WAYPOINT_DESC + 52 * i, 52))
        tail = F.WaypointTail.parse(w.tail)
        print(f"  waypoint[{i}] {w.name!r} route={w.route_name!r}  "
              f"{w.lat / 1e7:.7f}, {w.lon / 1e7:.7f}  type {tail.type} rank {tail.rank}")
    return crc == header.checksum and wpt_crc == waypoint_header.checksum


def run_nav(args):
    """READ-ONLY: reads the two navigation regions off the watch and decodes them.

    Nothing here writes. It is the first time this project reads the database rather than
    inferring it from a capture, which also makes it the backup that milestone 4 asked for
    and never had.
    """
    if args.from_capture:
        flash = FlashImage.from_pcap(args.from_capture)
        print(f"### {args.from_capture}, navigation database as written")
        return 0 if show_navigation(flash) else 1

    link = Link(dry_run=False, verbose=args.verbose)
    print("read-only: 0x0b17 reads flash, nothing is written")
    link.open()
    regions = {}
    for base, (name, size, _) in sorted(F.REGIONS.items()):
        if name == "GpsSGEE":
            continue  # 140000 bytes of ephemeris, nothing to do with navigation
        regions[name] = read_flash(link, base, size, label=name)

    flash = FlashImage()
    for base, (name, _, _) in sorted(F.REGIONS.items()):
        if name in regions:
            flash.write(base, regions[name])

    if args.save:
        for name, blob in regions.items():
            path = pathlib.Path(f"{args.save}-{name.lower()}.bin")
            path.write_bytes(blob)
            print(f"  saved {len(blob)} B to {path}")
    return 0 if show_navigation(flash) else 1


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
            print("  Note: a bond has IsNspCapable=0. Pairing does not set it, from "
                  "inside the Suunto\n  app or outside, so it has to be written through "
                  "0x1101. Whether the watch then\n  accepts the key as a token is the "
                  "open question of milestone 7.")
        if redacted:
            print("  Key material is redacted, so this output is safe to send as is.")
        else:
            print("  These are real link keys. Re-run with --redact to get output that "
                  "is safe\n  to paste or send.")
    else:
        print(f"\n  {slots} whitelist slot(s), none carrying a key: this watch has no "
              "bond.\n  Pair it with a phone, then read again.")
    return bonds


def read_pois(link, capture=None):
    """The watch's complete POI list, through 0x0b24.

    A navigation write erases it, whatever `tools/README.md` used to assume: confirmed on
    hardware 2026-08-04, a reset with no 0x0b25 lost every POI. Which is why SuuntoLink
    reads the list before writing and puts it back afterwards, in every capture we have.

    In dry-run there is no watch to ask, so the reply is taken from the capture being
    compared. That keeps --compare byte-exact rather than skipping the message.
    """
    reply = link.command(CMD_POI_READ, b"\0\0\0\0")
    if not link.dry_run:
        return reply
    if capture:
        for m in messages(capture):
            if m.command == CMD_POI_READ and m.incoming and m.payload:
                return m.payload
    return b""


def poi_write_payload(reply):
    """Turns a 0x0b24 reply into the 0x0b25 that puts the same POIs back, or None when
    there are none.

    The watch reports one SBEM entry per POI; the write concatenates them into a single
    entry, in the reverse of the order read. On `routedelete` that reversal is also the
    order SuuntoLink uses, most recently modified first, which is the same rule it applies
    to routes, and the result is byte-for-byte the payload in the capture. Reversing needs
    neither the schema nor any decoding of a POI's insides, so nothing here can mangle a
    POI it does not understand.

    `poiimport` puts a newly added POI first and the rest in that same order, which is how
    to add one rather than merely preserve them.
    """
    if not reply or F.SBEM_MAGIC not in reply:
        return None  # no watch to ask and no capture to borrow from, as in a bare dry-run
    records = [data for entry_id, data in F.sbem_entries(reply)
               if entry_id == POI_ENTRY]
    body = b"".join(reversed(records))
    if not body:
        return None
    if len(body) < 0xFF:
        header = bytes([POI_ENTRY, len(body)])
    else:
        header = bytes([POI_ENTRY, 0xFF]) + len(body).to_bytes(4, "little")
    return SBEM_WRITE_PREFIX + F.SBEM_MAGIC + header + body


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


def build_restore(prefix):
    """Rebuilds the two headers from regions saved by `nav --save`, without touching the
    data behind them.

    A reset rewrites only the two headers: 6 bytes and 32 bytes. Everything else -
    descriptors, points, index tables - stays in flash untouched, which a region read off
    the watch on 2026-08-04 showed directly. The leftovers there reproduced the CRCs of the
    `route128km` capture exactly, 0x8aaf and 0x6270, so both routes, all 1188 points with
    their 852 altitudes and all 11 waypoints had survived an erase byte for byte.

    So undoing an erase means writing correct counts and CRCs back into two headers. The
    closing hashes are exact rather than guessed, because the saved region gives the whole
    of what the flash will hold once the header is patched.
    """
    routes = pathlib.Path(f"{prefix}-routes.bin").read_bytes()
    waypoints = pathlib.Path(f"{prefix}-waypoints.bin").read_bytes()
    if len(routes) != F.ROUTE_REGION_SIZE or len(waypoints) != F.WAYPOINT_REGION_SIZE:
        raise ValueError(f"expected {F.ROUTE_REGION_SIZE} and "
                         f"{F.WAYPOINT_REGION_SIZE} bytes, got {len(routes)} and "
                         f"{len(waypoints)}")

    # Count what survived, reading the tables rather than the zeroed counters.
    descriptors, points = b"", 0
    base = F.ROUTE_DESC - F.ROUTE_BASE
    for i in range(F.MAX_ROUTES):
        blob = routes[base + 52 * i:base + 52 * (i + 1)]
        if blob[:1] in (b"\xff", b"\x00"):
            break
        descriptors += blob
        points += F.RouteDescriptor.parse(blob).point_count
    wpt_blob = b""
    base = F.WAYPOINT_DESC - F.WAYPOINT_BASE
    for i in range(F.MAX_WAYPOINTS):
        blob = waypoints[base + 52 * i:base + 52 * (i + 1)]
        if blob[:1] == b"\xff" or blob[:8] == b"\0" * 8:
            break
        wpt_blob += blob
    route_count, waypoint_count = len(descriptors) // 52, len(wpt_blob) // 52
    print(f"  recovered {route_count} route(s), {points} points, "
          f"{waypoint_count} waypoint(s)")
    if not route_count:
        raise ValueError("no route left in the saved region, nothing to restore")

    body = routes[F.ROUTE_POINTS - F.ROUTE_BASE:][:12 * points]
    route_header = F.RouteHeader(
        route_count, points, F.crc16_ccitt_false(descriptors + body)).build()
    waypoint_header = F.WaypointHeader.build_for(wpt_blob, waypoint_count)

    # The flash image holds the whole region so the closing hash is computed over what the
    # watch will really contain; only the headers are in the layout, so only they go out.
    flash = FlashImage()
    flash.write(F.ROUTE_BASE, route_header + routes[len(route_header):])
    flash.write(F.WAYPOINT_BASE, waypoint_header + waypoints[len(waypoint_header):])
    layout = [("waypoint header", F.WAYPOINT_BASE, waypoint_header),
              ("tail", F.WAYPOINT_BASE, None),
              ("route header", F.ROUTE_BASE, route_header),
              ("tail", F.ROUTE_BASE, None)]
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
    compared = (CMD_DATA_WRITE, CMD_DATA_TAIL, CMD_POI_WRITE)
    expected = [(m.command, m.payload) for m in messages(capture)
                if not m.incoming and m.command in compared]
    produced = [(command, payload) for command, payload, _ in link.sent
                if command in compared]
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
    print(f"\n  {'OK   ' if ok else 'FAIL '} {len(produced)} 0x0b16/0x0b18/0x0b25 "
          f"payloads compared to {capture}")
    return ok


def reply_from_capture(capture, command):
    for m in messages(capture):
        if m.command == command and m.incoming and m.payload:
            return m.payload
    raise ValueError(f"no 0x{command:04x} reply in {capture}")


def run_query(args):
    """READ-ONLY: the three queries send a request and decode the reply, and none of them
    writes, so none takes --write.

    `logbook` returns one page. The watch pages a long list, newest move first, and the
    continuation cursor sits in the reply prefix; paging is not implemented because a run
    made to look at the newest activity does not need it.
    """
    command, request, interesting = QUERIES[args.action]

    if args.from_capture:
        try:
            payload = reply_from_capture(args.from_capture, command)
        except ValueError as exc:
            print(f"  {exc}.")
            return 1
        print(f"### {args.from_capture}, 0x{command:04x} reply ({len(payload)} B)")
    else:
        link = Link(dry_run=False, verbose=args.verbose)
        print(f"read-only: the 0x{command:04x} query, nothing is written")
        link.open()
        payload = link.command(command, request)
        print(f"  reply {len(payload)} B")

    if args.action == "settings":
        return 0 if show_settings(payload, args.all, args.redact) is not None else 1
    return 0 if show_entries(payload, interesting, args.all, args.redact) is not None else 1


def show_entries(payload, interesting, show_all=False, redacted=False):
    """Names and decodes a reply's SBEM entries. Returns None when the schema is missing,
    for the same reason show_settings() does: an unnamed dump must not read as an answer.
    """
    import sbem_schema

    head = payload.find(sbem_schema.MAGIC)
    if head < 0:
        print("  no SBEM0102 payload in the reply")
        return None
    descriptor = sbem_schema.default_descriptor()
    if not descriptor.exists():
        print(f"  CANNOT DECIDE: the SuuntoLink descriptor is missing from "
              f"{descriptor.parent},\n  so the entries cannot be named. See "
              f"tools/sbem_schema.py.")
        for entry_id, data in sbem_schema.entries(payload[head:]):
            print(f"  0x{entry_id:02x} [{len(data)}] {data[:32].hex(' ')}")
        return None

    schema = sbem_schema.load(descriptor)
    shown = 0
    for entry_id, data in sbem_schema.entries(payload[head:]):
        if not (show_all or entry_id in interesting):
            continue
        print(f"  0x{entry_id:02x} {schema.label(entry_id) or '?'}  [{len(data)}]")
        for record in schema.decode_entry(entry_id, data) or []:
            shown += 1
            print("        " + "  ".join(
                f"{schema.field_name(entry_id, f.fid)}="
                f"{show_value(schema.field_name(entry_id, f.fid), v, redacted)}"
                for f, v in record))
    print(f"\n  {shown} record(s)")
    return shown


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("action",
                        choices=("reset", "route", "settings", "pois",
                                 "logbook", "nav", "restore"))
    parser.add_argument("gpx", nargs="*")
    parser.add_argument("--write", action="store_true",
                        help="actually emits; without this option nothing is sent")
    parser.add_argument("--meta", metavar="CAPTURE",
                        help="takes distance, ascent, descent and timestamp from it")
    parser.add_argument("--compare", metavar="CAPTURE",
                        help="checks the simulated payloads against a capture")
    parser.add_argument("--from", metavar="CAPTURE", dest="from_capture",
                        help="settings, pois, logbook, nav: decode a capture, no watch")
    parser.add_argument("--all", action="store_true",
                        help="settings: every entry, not just the BLE bonds and pods")
    parser.add_argument("--redact", action="store_true",
                        help="settings: mask keys and MAC, output safe to send")
    parser.add_argument("--save", metavar="PREFIX",
                        help="nav: also write the raw regions to PREFIX-*.bin")
    parser.add_argument("--verbose", action="store_true",
                        help="logs every 64-byte report")
    args = parser.parse_args()

    if args.action == "route" and not args.gpx:
        parser.error("route expects at least one GPX")
    if args.action == "restore" and len(args.gpx) != 1:
        parser.error("restore expects the prefix used by `nav --save`")
    if args.action == "nav":
        if args.write:
            parser.error("nav is read-only, --write has nothing to write")
        return run_nav(args)
    if args.action in QUERIES:
        if args.write:
            parser.error(f"{args.action} is read-only, --write has nothing to write")
        return run_query(args)
    if args.from_capture or args.all or args.redact or args.save:
        parser.error("--from, --all, --redact and --save do not apply to reset or route")

    link = Link(dry_run=not args.write, verbose=args.verbose)
    if args.write:
        print("!! REAL WRITE requested")
        link.open()
    else:
        print("dry-run mode: not a byte will be emitted")

    link.command(CMD_DEVICE_INFO, b"\x02\x48\x03\x00")
    # SuuntoLink reads the POI list here, before the memory map, and writes it back
    # after the commit. Skipping that is what erased André's POIs on 2026-08-04.
    pois = read_pois(link, args.compare or args.meta)
    check_memory_map(read_memory_map(link))

    if args.action == "reset":
        flash, layout = build_reset()
    elif args.action == "restore":
        flash, layout = build_restore(args.gpx[0])
    else:
        flash, layout = build_routes([pathlib.Path(p) for p in args.gpx], args.meta)
    send_plan(link, flash, layout)

    restored = poi_write_payload(pois)
    if restored:
        link.command(CMD_POI_WRITE, restored)
    elif link.dry_run and not (args.compare or args.meta):
        # A dry-run has no watch to ask, so it cannot show the 0x0b25 a live run will send.
        # Saying "no POI" here once made a rehearsal announce one message fewer than the
        # real write, on a watch that did have a POI. A rehearsal must not undercount.
        print("  a live run would read the watch's POI list here and write it back "
              "afterwards,\n  which this rehearsal cannot show: expect one more 0x0b25 "
              "than the count below.\n  Give --compare or --meta to rehearse that message "
              "against a capture.")
    else:
        print("  no POI to put back")

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
