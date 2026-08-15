"""Suunto packet protocol (D9 family — verified against T6d captures)."""

from __future__ import annotations

from dataclasses import dataclass

from suunto_t6_sync.transport import ProtocolError, Transport, read_exact

# vendor/t6-0.5.c RWMAX=200; STM used up to 0xC4 (196) in our capture.
MAX_MEMORY_READ = 200
# Response param length = 3 (addr+count) + data; allow headroom under 256.
MAX_PARAM_LENGTH = 255


def xor_checksum(data: bytes) -> int:
    value = 0
    for byte in data:
        value ^= byte
    return value


@dataclass(frozen=True)
class Packet:
    command: int
    parameters: bytes

    def to_bytes(self) -> bytes:
        length = len(self.parameters)
        header = bytes([self.command, (length >> 8) & 0xFF, length & 0xFF]) + self.parameters
        return header + bytes([xor_checksum(header)])


def build_get_version() -> bytes:
    return Packet(command=0x0F, parameters=b"").to_bytes()


def build_read_memory(address: int, count: int) -> bytes:
    if not 1 <= count <= MAX_MEMORY_READ:
        raise ValueError(f"count must be 1..{MAX_MEMORY_READ}")
    if not 0 <= address <= 0xFFFF:
        raise ValueError("address must be 16-bit")
    params = bytes([(address >> 8) & 0xFF, address & 0xFF, count & 0xFF])
    return Packet(command=0x05, parameters=params).to_bytes()


def build_simple_command(command: int) -> bytes:
    """Zero-parameter command (e.g. 0x0E, 0x10 probe)."""
    return Packet(command=command, parameters=b"").to_bytes()


def try_parse_frame(data: bytes, offset: int = 0) -> tuple[Packet, bytes] | None:
    """Parse one D9-style frame at *offset*.

    Returns ``(Packet, full_frame_bytes)`` including trailing checksum, or ``None``
    if the bytes at *offset* are not a valid frame.
    """
    if offset + 3 >= len(data):
        return None
    command = data[offset]
    length = (data[offset + 1] << 8) | data[offset + 2]
    if length > MAX_PARAM_LENGTH:
        return None
    end = offset + 3 + length  # index of checksum
    if end >= len(data):
        return None
    header = data[offset:end]
    checksum = data[end]
    if xor_checksum(header) != checksum:
        return None
    full = data[offset : end + 1]
    return Packet(command=command, parameters=data[offset + 3 : end]), full


def read_frame(transport: Transport, *, expect_command: int | None = None) -> Packet:
    """Read one framed response from *transport*."""
    header = read_exact(transport, 3, label="frame header")
    command = header[0]
    length = (header[1] << 8) | header[2]
    if length > MAX_PARAM_LENGTH:
        raise ProtocolError(f"implausible frame length {length} (cmd=0x{command:02x})")
    rest = read_exact(transport, length + 1, label="frame body")
    full = header + rest
    parsed = try_parse_frame(full)
    if parsed is None:
        raise ProtocolError(f"checksum/frame error: {full.hex(' ')}")
    packet, _ = parsed
    if expect_command is not None and packet.command != expect_command:
        raise ProtocolError(
            f"expected cmd 0x{expect_command:02x}, got 0x{packet.command:02x} "
            f"({full.hex(' ')})"
        )
    return packet


def transact(transport: Transport, request: bytes, *, expect_command: int) -> Packet:
    """Write *request*, read one response frame with matching command."""
    transport.reset_input_buffer()
    transport.write(request)
    return read_frame(transport, expect_command=expect_command)


def parse_read_memory_response(packet: Packet, *, address: int, count: int) -> bytes:
    """Extract payload from a ReadMemory response packet (parameters only).

    Layout (t6-0.5.c / T6d capture)::

        addr_hi addr_lo count data…
    """
    if packet.command != 0x05:
        raise ProtocolError(f"not a ReadMemory response: 0x{packet.command:02x}")
    params = packet.parameters
    if len(params) < 3:
        raise ProtocolError(f"ReadMemory response too short: {params.hex(' ')}")
    resp_addr = (params[0] << 8) | params[1]
    resp_count = params[2]
    if resp_addr != address:
        raise ProtocolError(f"address mismatch: requested 0x{address:04x}, got 0x{resp_addr:04x}")
    if resp_count != count:
        raise ProtocolError(f"count mismatch: requested {count}, got {resp_count}")
    data = params[3:]
    if len(data) != count:
        # Device may return fewer bytes than requested; accept and surface length.
        if len(data) == 0:
            raise ProtocolError("ReadMemory response contained no data")
    return data
