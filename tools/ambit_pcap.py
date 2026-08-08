"""Reading of the SuuntoLink <-> Ambit3 USBPcap captures.

Three levels: USB packets -> reassembled Ambit messages -> flash image.
The HID framing follows openambit's protocol.c.
"""

import struct

from ambit_format import crc16_ccitt_false

PCAP_MAGIC_LE = 0xA1B2C3D4
LINKTYPE_USBPCAP = 249

CMD_NAMES = {
    0x0000: "device_info",
    0x0300: "time",
    0x0302: "date",
    0x0306: "status",
    0x0B02: "waypoint_count",
    0x0B03: "waypoint_read",
    0x0B04: "nav_memory_commit",  # named nav_memory_delete in openambit
    0x0B05: "waypoint_write",
    0x0B15: "gps_orbit_head",
    0x0B16: "data_write",
    0x0B17: "log_read",
    0x0B18: "data_tail_len",
    0x0B1B: "write_start",
    0x0B1E: "ambit3_get_compact_serial",
    0x0B21: "ambit3_memory_map",
    0x0B24: "unknown_0b24",
    0x0B25: "sbem_nav_payload",  # unknown4 in openambit
    0x0B26: "unknown_0b26",
    0x0B19: "unknown_0b19",  # seen in BLE log-sync capture 2026-08-06, meaning unclear
    0x0B1A: "unknown_0b1a",  # seen in BLE log-sync capture 2026-08-06, meaning unclear
    0x1100: "ambit3_settings",
    0x1200: "ambit3_log_headers",
    0x1201: "ambit3_log_synced",
    0x0102: "fw_mode",  # bookends a firmware transfer, seen once before and once after
    0x0103: "fw_mode_ack",
    0x0E00: "fw_header",  # see firmware_flash.py
    0x0E01: "fw_data",  # see firmware_flash.py
    0x0E03: "fw_commit",  # see firmware_flash.py
    0x0200: "fw_reboot",  # seen right after fw_commit, before device_info reports normal mode again
    0x0002: "unknown_0002_hello",  # seen in iOS BLE capture 2026-08-08, first msg after encryption
    0x1104: "unknown_1104_schema_push",  # seen in iOS BLE capture 2026-08-08, self-describing field-path tree
    0x1202: "unknown_1202",  # seen in iOS BLE capture 2026-08-08, errFlags=0x02 anomaly, see HANDOFF.md
}


class Message:
    __slots__ = ("incoming", "command", "payload", "index")

    def __init__(self, incoming, command, payload, index):
        self.incoming = incoming
        self.command = command
        self.payload = payload
        self.index = index

    @property
    def name(self):
        return CMD_NAMES.get(self.command, f"0x{self.command:04x}")

    def __repr__(self):
        d = "IN " if self.incoming else "OUT"
        return f"<{d} 0x{self.command:04x} {self.name} len={len(self.payload)}>"


def usb_payloads(path):
    """USB payloads of a USBPcap file, with the endpoint number."""
    data = open(path, "rb").read()
    magic, = struct.unpack("<I", data[:4])
    if magic != PCAP_MAGIC_LE:
        raise ValueError(f"{path}: unexpected pcap magic 0x{magic:08x}")
    linktype, = struct.unpack("<I", data[20:24])
    if linktype != LINKTYPE_USBPCAP:
        raise ValueError(f"{path}: linktype {linktype}, expected {LINKTYPE_USBPCAP}")

    off = 24
    while off + 16 <= len(data):
        _, _, incl, _ = struct.unpack("<IIII", data[off:off + 16])
        off += 16
        rec = data[off:off + incl]
        off += incl
        if len(rec) < 28:
            continue
        hdr_len, = struct.unpack("<H", rec[:2])
        yield rec[21], rec[hdr_len:]


def messages(path):
    """Reassembled Ambit messages. First packet MP=0x5d (42 payload bytes at +20),
    subsequent ones MP=0x5e (54 B at +8). The command is big-endian."""
    out = []
    current = None
    for endpoint, pay in usb_payloads(path):
        if len(pay) < 20 or pay[0] != 0x3F:
            continue
        if pay[2] == 0x5D:
            command, = struct.unpack(">H", pay[8:10])
            total, = struct.unpack("<I", pay[16:20])
            current = [bool(endpoint & 0x80), command, total,
                       bytearray(pay[20:20 + min(42, total)])]
            out.append(current)
        elif pay[2] == 0x5E and current is not None:
            missing = current[2] - len(current[3])
            if missing > 0:
                current[3] += pay[8:8 + min(54, missing)]
    return [Message(m[0], m[1], bytes(m[3]), i) for i, m in enumerate(out)]


LEGACY_SEND_RECV = {0: 5, 1: 1, 2: 0x15}
LEGACY_FORMAT = {0: 9, 1: 0, 2: 9}


def encode_message(command, payload=b"", sequence=0, legacy=0,
                   send_recv=None, fmt=None):
    """The 64-byte HID reports of an outgoing message, per protocol.c's
    finalize_packet(). Verified by round trip on the outgoing messages of the captures.

    20-byte header: [u8 0x3f][u8 UL][u8 MP][u8 ML][u16 parts][u16 crc]
    [u16 command in BIG-endian][u16 send_recv][u16 format][u16 sequence]
    [u32 total length]. Payload at +20 for the first packet (42 B at most), at +8 for
    the subsequent ones (54 B). The payload CRC is written right after, at offset UL.

    `send_recv` and `fmt` are independent, contrary to what openambit's
    `legacy_format` parameter suggests by deriving both from a single integer: the
    firmware capture shows a 0x0102 with send_recv=1 and format=9, a combination that
    enum cannot produce.
    """
    total = len(payload)
    count = 1
    if total > 42:
        count = 1 + (total - 42) // 54 + (1 if (total - 42) % 54 else 0)

    if send_recv is None:
        send_recv = LEGACY_SEND_RECV[legacy]
    if fmt is None:
        fmt = LEGACY_FORMAT[legacy]
    reports = []
    offset = 0
    for part in range(count):
        buf = bytearray(64)
        if part == 0:
            chunk = min(42, total)
            struct.pack_into("<HH", buf, 4, count, 0)
            struct.pack_into(">H", buf, 8, command)
            struct.pack_into("<HHH", buf, 10, send_recv, fmt, sequence)
            struct.pack_into("<I", buf, 16, total)
            buf[20:20 + chunk] = payload[offset:offset + chunk]
            buf[2] = 0x5D
            body_len = chunk + 12
        else:
            chunk = min(54, total - offset)
            struct.pack_into("<H", buf, 4, part)
            buf[8:8 + chunk] = payload[offset:offset + chunk]
            buf[2] = 0x5E
            body_len = chunk
        buf[0] = 0x3F
        buf[1] = body_len + 8
        buf[3] = body_len
        header_crc = crc16_ccitt_false(buf[2:6])
        struct.pack_into("<H", buf, 6, header_crc)
        struct.pack_into("<H", buf, buf[1],
                         crc16_ccitt_false(buf[8:8 + body_len], header_crc))
        reports.append(bytes(buf))
        offset += chunk
    return reports


def outgoing_reports(path):
    """Outgoing HID reports of a capture, grouped by message."""
    groups = []
    for endpoint, pay in usb_payloads(path):
        if len(pay) < 20 or pay[0] != 0x3F or endpoint & 0x80:
            continue
        if pay[2] == 0x5D:
            groups.append([pay[:64]])
        elif groups:
            groups[-1].append(pay[:64])
    return groups


def write_packs(msgs):
    """(address, length, sequence, body) of every outgoing 0x0b16."""
    packs = []
    for m in msgs:
        if m.incoming or m.command != 0x0B16 or len(m.payload) < 8:
            continue
        addr, length, seq = struct.unpack("<IHH", m.payload[:8])
        packs.append((addr, length, seq, m.payload[8:8 + length]))
    return packs


def tails(msgs):
    """(address, unknown word, hex hash) of every outgoing 0x0b18."""
    out = []
    for m in msgs:
        if m.incoming or m.command != 0x0B18 or len(m.payload) < 8:
            continue
        addr, extra = struct.unpack("<II", m.payload[:8])
        out.append((addr, extra, m.payload[8:].decode("ascii", "replace")))
    return out


class FlashImage:
    """Sparse flash image. Bytes never written take the fill value requested at read
    time: 0x00 to inspect, 0xff to hash (cf. the region hash)."""

    def __init__(self, packs=()):
        self.bytes = {}
        for addr, _, _, body in packs:
            self.write(addr, body)

    @classmethod
    def from_pcap(cls, path):
        return cls(write_packs(messages(path)))

    def write(self, addr, body):
        for i, b in enumerate(body):
            self.bytes[addr + i] = b

    def read(self, addr, size, fill=0x00):
        return bytes(self.bytes.get(addr + i, fill) for i in range(size))

    def ranges(self):
        """Contiguous ranges actually written, sorted by address."""
        keys = sorted(self.bytes)
        if not keys:
            return []
        out = []
        start = prev = keys[0]
        for k in keys[1:]:
            if k != prev + 1:
                out.append((start, prev - start + 1))
                start = k
            prev = k
        out.append((start, prev - start + 1))
        return out
