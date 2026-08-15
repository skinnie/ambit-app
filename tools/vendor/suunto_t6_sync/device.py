"""High-level read-only device API (GetVersion, ReadMemory, list logs)."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from suunto_t6_sync.decoder import DecodedLog, decode_log
from suunto_t6_sync.exporter import ExportFormat, export_decoded_log
from suunto_t6_sync.log_header import (
    LOCLOGH,
    T6D_LOG_HEADER_SIZE,
    LogHeader,
    page_to_address,
    parse_log_header,
    parse_log_page_directory,
)
from suunto_t6_sync.protocol import (
    MAX_MEMORY_READ,
    build_get_version,
    build_read_memory,
    build_simple_command,
    parse_read_memory_response,
    transact,
)
from suunto_t6_sync.transport import ProtocolError, Transport

# From vendor/t6-0.5.c
LOCSER = 0x005A
LOCVER = 0x00F0
# Firmware copy immediately after serial (live T6d: matches GetVersion params).
LOCFW = 0x005E

# GetVersion product byte (params[0]) confirmed on two owner-verified T6d units:
#   sn 14800205 SW 2.1.3  → 08 02 01 03
#   sn 02204432 SW 2.0.17 → 08 02 00 11
T6D_PRODUCT_BYTE = 0x08


def decode_wristop_serial(raw: bytes) -> str:
    """Decode LOCSER (4 bytes) to STM ``WRISTOPID`` decimal string.

    Each byte is a two-digit decimal field, concatenated. Live T6d
    ``0e 50 02 05`` → ``14800205`` (matches Training Manager).
    """
    if len(raw) < 4:
        raise ValueError(f"serial needs 4 bytes, got {len(raw)}")
    if any(b > 99 for b in raw[:4]):
        raise ValueError(f"serial byte out of 0..99 range: {raw[:4].hex(' ')}")
    return "".join(f"{b:02d}" for b in raw[:4])


def encode_wristop_serial(serial: str) -> bytes:
    """Inverse of :func:`decode_wristop_serial` (for tests / fixtures)."""
    digits = serial.strip()
    if not digits.isdigit() or len(digits) != 8:
        raise ValueError("serial must be 8 decimal digits")
    return bytes(int(digits[i : i + 2]) for i in range(0, 8, 2))


def detect_model(
    *,
    product_byte: int | None,
    log_header_size: int | None = None,
) -> str:
    """Detect wristop model from GetVersion + optional header size.

    Returns ``T6d`` when product byte is ``0x08`` (confirmed on two T6d units).
    Multi-SKU mapping stops here: no classic T6 or T6c hardware was available to
    expand the table. Header-size fallbacks only.
    """
    if product_byte == T6D_PRODUCT_BYTE:
        return "T6d"
    if log_header_size == 46:
        return "T6"
    if log_header_size is not None and log_header_size >= T6D_LOG_HEADER_SIZE:
        # 61-byte path without product 0x08 — not mapped to a SKU.
        return "T6d-class"
    return "unknown"


@dataclass(frozen=True)
class DeviceVersion:
    """GetVersion response parameters (raw + best-effort decode)."""

    raw: bytes

    @property
    def product_byte(self) -> int | None:
        """First GetVersion byte (T6d: ``0x08`` on both known units)."""
        return self.raw[0] if self.raw else None

    @property
    def firmware_hint(self) -> str | None:
        """SW version as ``major.minor.patch`` from GetVersion params[1:]."""
        if len(self.raw) >= 4:
            return f"{self.raw[1]}.{self.raw[2]}.{self.raw[3]}"
        if len(self.raw) == 3:
            return f"{self.raw[0]}.{self.raw[1]}.{self.raw[2]}"
        return None


@dataclass(frozen=True)
class DeviceIdentity:
    """Summary of version + serial + model (read-only probe)."""

    version: DeviceVersion
    serial_raw: bytes
    serial: str
    log_header_size: int
    log_count: int
    cmd_0e: bytes | None = None
    cmd_0x10: bytes | None = None

    @property
    def model(self) -> str:
        """Detected model string (e.g. ``T6d``). See :func:`detect_model`."""
        return detect_model(
            product_byte=self.version.product_byte,
            log_header_size=self.log_header_size,
        )

    @property
    def layout_class(self) -> str:
        """Memory/header layout family (orthogonal to SKU label)."""
        if self.log_header_size >= T6D_LOG_HEADER_SIZE:
            return "61-byte-header"
        if self.log_header_size == 46:
            return "46-byte-header"
        return "unknown"

    @property
    def firmware_hint(self) -> str | None:
        return self.version.firmware_hint

    def to_recording_device_identity(
        self,
        *,
        hardware_id: str | None = None,
    ) -> dict[str, str]:
        """Plain bag for the ``device.json`` sidecar.

        Shape::

            {
              "manufacturer": "Suunto",
              "model": "T6d",
              "hardwareId": "14800205",
              "firmwareVersion": "2.1.3"
            }

        Preserves device metadata next to exports so importers or UIs can label
        sessions without re-reading USB.
        """
        props: dict[str, str] = {"manufacturer": "Suunto"}
        model = self.model
        # Only emit clean SKU labels (not layout fallbacks like ``T6d-class``).
        if model in {"T6d", "T6", "T6c"}:
            props["model"] = model
        props["hardwareId"] = hardware_id if hardware_id is not None else self.serial
        if self.firmware_hint:
            props["firmwareVersion"] = self.firmware_hint
        return props


@dataclass(frozen=True)
class LogSummary:
    index: int
    page: int
    address: int
    header: LogHeader


class SuuntoDevice:
    """Read-only Suunto T6 / T6c / T6d session over an open transport."""

    def __init__(self, transport: Transport) -> None:
        self._transport = transport

    def get_version(self) -> DeviceVersion:
        packet = transact(
            self._transport,
            build_get_version(),
            expect_command=0x0F,
        )
        return DeviceVersion(raw=packet.parameters)

    def probe_command(self, command: int) -> bytes:
        """Send a zero-parameter command; return response parameters."""
        packet = transact(
            self._transport,
            build_simple_command(command),
            expect_command=command,
        )
        return packet.parameters

    def read_memory(self, address: int, count: int) -> bytes:
        """Read *count* bytes starting at *address* (chunks if needed)."""
        if count < 1:
            raise ValueError("count must be >= 1")
        if not 0 <= address <= 0xFFFF:
            raise ValueError("address must be 16-bit")
        if address + count - 1 > 0xFFFF:
            raise ValueError("read would cross 64K boundary")

        out = bytearray()
        remaining = count
        cursor = address
        while remaining > 0:
            chunk = min(remaining, MAX_MEMORY_READ)
            # Do not cross 64K bank (t6-0.5.c).
            if (cursor // 0x10000) != ((cursor + chunk - 1) // 0x10000):
                chunk = ((cursor + chunk) & 0xFFFF0000) - cursor
            data = self._read_memory_chunk(cursor, chunk)
            out.extend(data)
            # Advance by bytes actually returned (device may short-read).
            got = len(data)
            if got == 0:
                raise ProtocolError(f"empty ReadMemory at 0x{cursor:04x}")
            cursor += got
            remaining -= got
            if got < chunk:
                # Short read: stop rather than loop forever.
                break
        if len(out) != count and remaining > 0:
            # Return what we got; caller can check length.
            pass
        return bytes(out)

    def _read_memory_chunk(self, address: int, count: int) -> bytes:
        request = build_read_memory(address, count)
        packet = transact(self._transport, request, expect_command=0x05)
        return parse_read_memory_response(packet, address=address, count=count)

    def read_serial_number_bytes(self) -> bytes:
        return self.read_memory(LOCSER, 4)

    def read_serial_number(self) -> str:
        """STM-compatible wristop serial (e.g. ``14800205``)."""
        return decode_wristop_serial(self.read_serial_number_bytes())

    def get_identity(self, *, extra_commands: bool = True) -> DeviceIdentity:
        """GetVersion + serial + layout class (and optional 0x0E/0x10 probes)."""
        version = self.get_version()
        serial_raw = self.read_serial_number_bytes()
        serial = decode_wristop_serial(serial_raw)
        pages = self.list_log_pages()
        cmd_0e: bytes | None = None
        cmd_10: bytes | None = None
        if extra_commands:
            try:
                cmd_0e = self.probe_command(0x0E)
            except ProtocolError:
                cmd_0e = None
            try:
                cmd_10 = self.probe_command(0x10)
            except ProtocolError:
                cmd_10 = None
        return DeviceIdentity(
            version=version,
            serial_raw=serial_raw,
            serial=serial,
            log_header_size=T6D_LOG_HEADER_SIZE,
            log_count=len(pages),
            cmd_0e=cmd_0e,
            cmd_0x10=cmd_10,
        )

    def list_log_pages(self) -> list[int]:
        directory = self.read_memory(LOCLOGH, 30)
        return parse_log_page_directory(directory)

    def read_log_header(self, page: int) -> LogHeader:
        address = page_to_address(page)
        raw = self.read_memory(address, T6D_LOG_HEADER_SIZE)
        if len(raw) < 28:
            raise ProtocolError(
                f"log header at 0x{address:04x} too short ({len(raw)} bytes)"
            )
        return parse_log_header(raw)

    def list_logs(self) -> list[LogSummary]:
        pages = self.list_log_pages()
        logs: list[LogSummary] = []
        for index, page in enumerate(pages):
            header = self.read_log_header(page)
            logs.append(
                LogSummary(
                    index=index,
                    page=page,
                    address=page_to_address(page),
                    header=header,
                )
            )
        return logs

    def decode_log(self, header_page: int) -> DecodedLog:
        """Decode one log (header + altitude series) by header page index."""
        return decode_log(self, header_page)

    def decode_log_by_index(self, index: int) -> DecodedLog:
        pages = self.list_log_pages()
        if not 0 <= index < len(pages):
            raise IndexError(f"log index {index} out of range 0..{len(pages) - 1}")
        return self.decode_log(pages[index])

    def resolve_wristop_id(self, wristop_id: str | None) -> str:
        """Return explicit wristop id or LOCSER decoded as STM WRISTOPID."""
        if wristop_id is not None:
            return wristop_id
        try:
            return self.read_serial_number()
        except Exception:
            return "0"

    def export_log(
        self,
        index: int,
        out_dir: Path,
        *,
        wristop_id: str | None = None,
        write_beats: bool = False,
        fmt: ExportFormat = "xml",
        force: bool = False,
    ) -> tuple[Path, bool]:
        """Decode log *index* and write XML or JSON. Returns ``(path, written)``."""
        decoded = self.decode_log_by_index(index)
        return export_decoded_log(
            decoded,
            out_dir,
            wristop_id=self.resolve_wristop_id(wristop_id),
            write_beats=write_beats,
            fmt=fmt,
            force=force,
        )

    def export_log_xml(
        self,
        index: int,
        out_dir: Path,
        *,
        wristop_id: str | None = None,
        write_beats: bool = False,
        force: bool = False,
    ) -> Path:
        """Decode log *index* and write Training Manager XML (+ optional beats)."""
        path, _written = self.export_log(
            index,
            out_dir,
            wristop_id=wristop_id,
            write_beats=write_beats,
            fmt="xml",
            force=force,
        )
        return path
