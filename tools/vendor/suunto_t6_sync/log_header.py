"""T6d log header parsing (verified against STM capture + XML).

Header size on live **T6d** (SW 2.1.3) is **61 bytes** (``0x3d``), not the
46-byte layout from Paul Brennan ``t6-0.5.c`` (2005, classic T6). Date encoding
also differs: full year as little-endian ``u16`` instead of packed YY/MM/DD decades.

T6c may share this layout but has **not** been verified on hardware in this repo.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

# STM reads 61-byte headers on T6d; old t6-0.5.c used HDRSIZE 46.
T6D_LOG_HEADER_SIZE = 61
# Backward-compatible alias (earlier docs mislabeled the unit as T6c).
T6C_LOG_HEADER_SIZE = T6D_LOG_HEADER_SIZE

# Absolute address of the log-header page directory (still matches t6-0.5.c).
LOCLOGH = 0x0FB4


def page_to_address(page: int) -> int:
    """Map a log page index to an absolute memory address.

    Formula from ``vendor/t6-0.5.c``: ``PADDR(p) = p * 0x200 + 0xE00``.
    Confirmed on T6d: pages ``0x01 → 0x1000``, ``0x2c → 0x6600``, ``0x31 → 0x7000``.
    """
    if not 0 <= page <= 0xFF:
        raise ValueError("page must be 0..255")
    return page * 0x200 + 0xE00


def parse_log_page_directory(data: bytes) -> list[int]:
    """Parse the LOCLOGH region into a list of log page indices.

    Observed layout: consecutive non-zero page bytes until a ``0x00`` terminator
    (30-byte read in STM traffic; only the first few entries used).
    """
    pages: list[int] = []
    for byte in data:
        if byte == 0:
            break
        pages.append(byte)
    return pages


def packed_duration_seconds(hours: int, minutes: int, seconds: int, tenths: int) -> float:
    """Decode duration as H:M:S + tenths (verified vs STM ``DURATION``)."""
    return hours * 3600 + minutes * 60 + seconds + tenths / 10.0


@dataclass(frozen=True)
class LogHeader:
    """Fields confirmed against Training Manager XML for the same sessions."""

    raw: bytes
    start: datetime
    duration_s: float
    sample_interval_s: int
    max_altitude_m: int
    min_altitude_m: int
    # Duration packing components (header +7..+10).
    duration_hours: int
    duration_minutes: int
    duration_seconds: int
    duration_tenths: int
    # Ascent / descent totals and times (exact vs STM for three logs).
    total_ascent_m: int
    ascent_time_s: int
    total_descent_m: int
    descent_time_s: int
    # Header +12: lap count (T6d).
    lap_count: int = 0

    @property
    def size(self) -> int:
        return len(self.raw)

    @property
    def sample_count(self) -> int:
        """Number of fixed-interval samples (matches STM XML SAMPLE count)."""
        if self.sample_interval_s <= 0:
            return 0
        # e.g. 6162.1s / 10s → 617 samples at ST=0,10,...,6160
        return int(self.duration_s / self.sample_interval_s) + 1

    def log_id(self) -> str:
        """Filename stem ``YYYYMMDD-HHMMSS`` for export files."""
        return self.start.strftime("%Y%m%d-%H%M%S")


def parse_log_header(data: bytes) -> LogHeader:
    """Parse a T6d (61-byte) log header blob."""
    if len(data) < 28:
        raise ValueError(f"log header too short: {len(data)} bytes")
    year = data[0] | (data[1] << 8)
    month = data[2]
    day = data[3]
    hour = data[4]
    minute = data[5]
    second = data[6]
    start = datetime(year, month, day, hour, minute, second)
    # +7..+10: duration as H, M, S, tenths.
    dur_h, dur_m, dur_s, dur_t = data[7], data[8], data[9], data[10]
    duration_s = packed_duration_seconds(dur_h, dur_m, dur_s, dur_t)
    # +11: sample interval (seconds).
    sample_interval_s = data[11]
    # +12: lap count (verified on T6d short multi-lap session + older logs).
    lap_count = data[12] if len(data) > 12 else 0
    # +13..+20: ascent/descent totals and times (u16 LE) — exact vs STM XML.
    total_ascent_m = int.from_bytes(data[13:15], "little")
    ascent_time_s = int.from_bytes(data[15:17], "little")
    total_descent_m = int.from_bytes(data[17:19], "little")
    descent_time_s = int.from_bytes(data[19:21], "little")
    # +21 / +26: max/min altitude as signed int16 LE.
    max_altitude_m = int.from_bytes(data[21:23], "little", signed=True)
    min_altitude_m = int.from_bytes(data[26:28], "little", signed=True)
    return LogHeader(
        raw=bytes(data[:T6D_LOG_HEADER_SIZE] if len(data) >= T6D_LOG_HEADER_SIZE else data),
        start=start,
        duration_s=duration_s,
        sample_interval_s=sample_interval_s,
        max_altitude_m=max_altitude_m,
        min_altitude_m=min_altitude_m,
        duration_hours=dur_h,
        duration_minutes=dur_m,
        duration_seconds=dur_s,
        duration_tenths=dur_t,
        total_ascent_m=total_ascent_m,
        ascent_time_s=ascent_time_s,
        total_descent_m=total_descent_m,
        descent_time_s=descent_time_s,
        lap_count=lap_count,
    )
