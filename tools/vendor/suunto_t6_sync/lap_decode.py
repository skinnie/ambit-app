"""T6d lap-record decode (verified on live short session 2026-08-08).

Laps live on the **header page** after the 61-byte log header:

* Header byte ``+12`` = lap count
* First lap at page offset ``61`` (``T6D_LOG_HEADER_SIZE``)
* Each record is **18 bytes** (classic ``t6-0.5.c`` used 15 @ ``LAP1OFF=0x3c``)

Layout of one 18-byte record (offsets within the record)::

    +0..+2  unknown (often zero; first record may be non-zero noise)
    +3      end marker (``1`` seen on final / stop lap)
    +4      duration hours
    +5      duration minutes
    +6      duration seconds
    +7      duration tenths (0.1 s)
    +8..+9  altitude m (i16 LE)
    +10..+11 ascent m (u16 LE)
    +12..+13 descent m (u16 LE)
    +14     HR at lap (bpm)
    +15     average HR (bpm)
    +16..+17 unknown / distance (0 on no-GPS T6d sessions)

``duration`` packing matches the session header duration fields.
``logtime`` (seconds from start) is the running sum of lap durations.
"""

from __future__ import annotations

from dataclasses import dataclass

from suunto_t6_sync.log_header import T6D_LOG_HEADER_SIZE, packed_duration_seconds

# First lap starts immediately after the 61-byte header on the header page.
T6D_LAP_PAGE_OFFSET = T6D_LOG_HEADER_SIZE  # 61
T6D_LAP_SIZE = 18
# Max laps that fit on the header page after the header blob.
T6D_LAPS_PER_HEADER_PAGE = (512 - T6D_LAP_PAGE_OFFSET) // T6D_LAP_SIZE  # 25


@dataclass(frozen=True)
class Lap:
    """One lap / interval marker from a training log."""

    index: int
    """1-based lap number (STM order)."""

    duration_s: float
    """Lap split duration in seconds."""

    logtime_s: float
    """Seconds from session start at end of this lap (sum of splits)."""

    altitude_m: int
    ascent_m: int
    descent_m: int
    heartrate: int
    heartrate_avg: int
    end_marker: int
    raw: bytes

    @property
    def is_end(self) -> bool:
        return self.end_marker == 1


def lap_count_from_header(header_raw: bytes) -> int:
    """Read lap count from header byte +12 (T6d)."""
    if len(header_raw) < 13:
        return 0
    return int(header_raw[12])


def parse_lap_record(data: bytes, *, index: int, logtime_s: float) -> Lap:
    """Parse one 18-byte T6d lap record."""
    if len(data) < T6D_LAP_SIZE:
        raise ValueError(f"lap record too short: {len(data)} < {T6D_LAP_SIZE}")
    raw = bytes(data[:T6D_LAP_SIZE])
    end_marker = raw[3]
    hours, minutes, seconds, tenths = raw[4], raw[5], raw[6], raw[7]
    duration_s = packed_duration_seconds(hours, minutes, seconds, tenths)
    altitude_m = int.from_bytes(raw[8:10], "little", signed=True)
    ascent_m = int.from_bytes(raw[10:12], "little")
    descent_m = int.from_bytes(raw[12:14], "little")
    heartrate = raw[14]
    heartrate_avg = raw[15]
    return Lap(
        index=index,
        duration_s=duration_s,
        logtime_s=logtime_s,
        altitude_m=altitude_m,
        ascent_m=ascent_m,
        descent_m=descent_m,
        heartrate=heartrate,
        heartrate_avg=heartrate_avg,
        end_marker=end_marker,
        raw=raw,
    )


def parse_laps_from_header_page(
    page: bytes,
    *,
    lap_count: int | None = None,
) -> list[Lap]:
    """Parse laps from a full 512-byte header page.

    If *lap_count* is omitted, uses header byte +12.
    """
    if len(page) < T6D_LAP_PAGE_OFFSET + T6D_LAP_SIZE:
        return []
    if lap_count is None:
        lap_count = lap_count_from_header(page)
    if lap_count <= 0:
        return []
    if lap_count > T6D_LAPS_PER_HEADER_PAGE:
        # Multi-page lap chains not yet observed on T6d short logs; cap for safety.
        lap_count = T6D_LAPS_PER_HEADER_PAGE

    laps: list[Lap] = []
    cumulative = 0.0
    for i in range(lap_count):
        start = T6D_LAP_PAGE_OFFSET + i * T6D_LAP_SIZE
        chunk = page[start : start + T6D_LAP_SIZE]
        if len(chunk) < T6D_LAP_SIZE:
            break
        # Skip clearly empty slots (all zero) if count is overstated.
        if chunk == b"\x00" * T6D_LAP_SIZE:
            break
        lap = parse_lap_record(chunk, index=i + 1, logtime_s=0.0)
        cumulative += lap.duration_s
        laps.append(
            Lap(
                index=lap.index,
                duration_s=lap.duration_s,
                logtime_s=round(cumulative, 1),
                altitude_m=lap.altitude_m,
                ascent_m=lap.ascent_m,
                descent_m=lap.descent_m,
                heartrate=lap.heartrate,
                heartrate_avg=lap.heartrate_avg,
                end_marker=lap.end_marker,
                raw=lap.raw,
            )
        )
    return laps
