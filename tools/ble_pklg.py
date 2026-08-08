"""Reading of Apple PacketLogger (.pklg) BLE captures of the Ambit3 NSP protocol.

Requires `tshark` (apt/brew install wireshark) to pull ATT reads/writes/notifies out
of the .pklg - the binary format itself is not reimplemented here, tshark's own
Bluetooth dissectors already do it correctly. This module reassembles the NSP layer
above that: the 0x7e-delimited, SLIP-escaped frames wrapping the same 12-byte header
used over USB (see ambit_pcap.py's CMD_NAMES, shared here).
"""

import struct
import subprocess
import sys
import zlib

from ambit_pcap import CMD_NAMES

WRITE_OPCODES = ("0x12", "0x52")  # ATT Write Request / Write Command
NOTIFY_OPCODES = ("0x1b", "0x1d")  # ATT Handle Value Notification / Indication


def att_records(path):
    """(frame_number, opcode, handle, direction, raw_bytes) for every ATT
    write/notification in the capture, in capture order."""
    out = subprocess.run(
        ["tshark", "-r", path,
         "-Y", "btatt.opcode in {0x12,0x52,0x1b,0x1d}",
         "-T", "fields",
         "-e", "frame.number", "-e", "btatt.opcode", "-e", "btatt.handle", "-e", "btatt.value"],
        capture_output=True, text=True, check=True,
    )
    for line in out.stdout.splitlines():
        parts = line.split("\t")
        if len(parts) < 4:
            continue
        frame, opcode, handle, value = parts[:4]
        direction = "OUT" if opcode in WRITE_OPCODES else "IN"
        yield int(frame), opcode, handle, direction, bytes.fromhex(value)


def _unescape_slip(buf):
    """0x7d 0x5e -> 0x7e, 0x7d 0x5d -> 0x7d (confirmed on real hardware, 2026-08-08:
    unescaped bytes throw the trailing CRC32 off by exactly the escape prefix byte)."""
    out = bytearray()
    i = 0
    while i < len(buf):
        b = buf[i]
        if b == 0x7d and i + 1 < len(buf) and buf[i + 1] in (0x5e, 0x5d):
            out.append(0x7e if buf[i + 1] == 0x5e else 0x7d)
            i += 2
        else:
            out.append(b)
            i += 1
    return bytes(out)


def _split_envelopes(buf):
    """0x7e-delimited frames; consecutive frames share a boundary byte."""
    i, n = 0, len(buf)
    while i < n and buf[i] != 0x7e:
        i += 1
    while i < n:
        j = i + 1
        while j < n and buf[j] != 0x7e:
            j += 1
        if j >= n:
            return
        yield buf[i + 1:j]
        i = j


class Message:
    __slots__ = ("direction", "command", "flags", "err_flags", "conn_id", "pkt_num",
                 "payload", "crc_ok")

    def __init__(self, direction, command, flags, err_flags, conn_id, pkt_num, payload, crc_ok):
        self.direction = direction
        self.command = command
        self.flags = flags
        self.err_flags = err_flags
        self.conn_id = conn_id
        self.pkt_num = pkt_num
        self.payload = payload
        self.crc_ok = crc_ok

    @property
    def name(self):
        return CMD_NAMES.get(self.command, f"0x{self.command:04x}")

    def __repr__(self):
        return (f"<{self.direction} 0x{self.command:04x} {self.name} flags=0x{self.flags:02x} "
                f"err=0x{self.err_flags:02x} pkt={self.pkt_num} len={len(self.payload)} "
                f"crc_ok={self.crc_ok}>")


def messages(path):
    """All NSP messages in a .pklg capture, in capture order, both directions
    interleaved (call with a direction/handle filter downstream if you only want one
    side or one connection)."""
    streams = {}
    for frame, opcode, handle, direction, value in att_records(path):
        streams.setdefault((handle, direction), bytearray()).extend(value)

    out = []
    for (handle, direction), buf in streams.items():
        for raw in _split_envelopes(buf):
            inner = _unescape_slip(raw)
            if len(inner) < 12:
                continue
            msg_id, sub_id, flags, err_flags, conn_id, pkt_num, data_size = struct.unpack(
                "<BBBBHHI", inner[:12])
            command = (msg_id << 8) | sub_id
            rest = inner[12:]
            payload = rest[:data_size]
            trailer = rest[data_size:]
            crc_ok = None
            if len(trailer) >= 4:
                calc = zlib.crc32(inner[:12 + data_size]) & 0xffffffff
                given = int.from_bytes(trailer[:4], "little")
                crc_ok = calc == given
            out.append(Message(direction, command, flags, err_flags, conn_id, pkt_num,
                                payload, crc_ok))
    return out


if __name__ == "__main__":
    for m in messages(sys.argv[1]):
        print(m)
        if 0 < len(m.payload) <= 80:
            ascii_ = "".join(chr(b) if 32 <= b < 127 else "." for b in m.payload)
            print(f"    {m.payload.hex()}  {ascii_}")
