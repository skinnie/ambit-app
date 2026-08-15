"""Decode training-log payloads from device memory pages."""

from __future__ import annotations

from dataclasses import dataclass

from suunto_t6_sync.hr_decode import (
    HeartRateSeries,
    beats_to_interval_hr,
    bytes_to_be_words,
    decode_beat_intervals,
    fill_hold_last,
    trim_beats_to_duration,
)
from suunto_t6_sync.lap_decode import Lap, parse_laps_from_header_page
from suunto_t6_sync.log_header import LogHeader, parse_log_header
from suunto_t6_sync.memory_pages import page_payload, read_page, read_page_chain

# First altitude data page carries a 6-byte stream header after the link byte.
# Observed on T6d: ``e0 00 00 00 NN NN`` then int16 LE samples.
ALT_STREAM_HEADER_LEN = 6


def altitude_start_page(header_page: int) -> int:
    """Altitude series starts two pages after the log header page (T6d)."""
    return header_page + 2


def hr_start_page(header_page: int) -> int:
    """HR beat stream starts one page after the log header page (T6d)."""
    return header_page + 1


def decode_int16_le_series(data: bytes) -> list[int]:
    if len(data) % 2:
        data = data[:-1]
    return [int.from_bytes(data[i : i + 2], "little", signed=True) for i in range(0, len(data), 2)]


def decode_altitude_from_pages(
    pages: list[tuple[int, bytes]],
    *,
    max_samples: int | None = None,
) -> list[int]:
    """Decode altitude (metres) from a page chain (naive, no resync)."""
    samples: list[int] = []
    for index, (_page, raw) in enumerate(pages):
        skip = ALT_STREAM_HEADER_LEN if index == 0 else 0
        payload = page_payload(raw, skip_leading=skip)
        samples.extend(decode_int16_le_series(payload))
        if max_samples is not None and len(samples) >= max_samples:
            return samples[:max_samples]
    return samples


def _altitude_stream_bytes(pages: list[tuple[int, bytes]]) -> bytes:
    chunks: list[bytes] = []
    for index, (_page, raw) in enumerate(pages):
        skip = ALT_STREAM_HEADER_LEN if index == 0 else 0
        chunks.append(page_payload(raw, skip_leading=skip))
    return b"".join(chunks)


def decode_altitude_with_resync(
    pages: list[tuple[int, bytes]],
    *,
    min_altitude_m: int,
    max_altitude_m: int,
    margin_m: int = 80,
    max_samples: int | None = None,
) -> list[int]:
    """Decode int16 LE altitudes, skipping 1–2 pad bytes when alignment breaks.

    Some T6d altitude page chains insert occasional single-byte padding mid-stream.
    When the next aligned int16 is outside the header altitude band, try shifting
    by one (then two) bytes. Verified exact vs STM XML for three live sessions.
    """
    stream = _altitude_stream_bytes(pages)
    lo = min(min_altitude_m, max_altitude_m) - margin_m
    hi = max(min_altitude_m, max_altitude_m) + margin_m
    samples: list[int] = []
    i = 0
    n = len(stream)
    while i + 2 <= n:
        if max_samples is not None and len(samples) >= max_samples:
            break
        value = int.from_bytes(stream[i : i + 2], "little", signed=True)
        if lo <= value <= hi:
            samples.append(value)
            i += 2
            continue
        recovered = False
        for shift in (1, 2):
            if i + shift + 2 > n:
                break
            alt = int.from_bytes(stream[i + shift : i + shift + 2], "little", signed=True)
            if lo <= alt <= hi:
                i += shift
                recovered = True
                break
        if not recovered:
            break
    return samples


def trim_altitude_series(
    samples: list[int],
    *,
    min_altitude_m: int,
    max_altitude_m: int,
    margin_m: int = 80,
    max_samples: int | None = None,
) -> list[int]:
    """Trim by header range and optional expected sample count."""
    if not samples:
        return samples
    lo = min(min_altitude_m, max_altitude_m) - margin_m
    hi = max(min_altitude_m, max_altitude_m) + margin_m
    out: list[int] = []
    for value in samples:
        if value < lo or value > hi:
            break
        out.append(value)
        if max_samples is not None and len(out) >= max_samples:
            break
    return out


def decode_hr_from_pages(
    pages: list[tuple[int, bytes]],
    *,
    duration_s: float,
    interval_s: int,
    sample_count: int,
) -> HeartRateSeries:
    data = b"".join(page_payload(raw) for _, raw in pages)
    words = bytes_to_be_words(data)
    beats = decode_beat_intervals(words)
    beats = trim_beats_to_duration(beats, duration_s)
    bpm_opt = beats_to_interval_hr(
        beats,
        interval_s=interval_s,
        sample_count=sample_count,
    )
    return HeartRateSeries(beat_intervals_ms=beats, bpm=fill_hold_last(bpm_opt))


@dataclass(frozen=True)
class DecodedLog:
    header_page: int
    header: LogHeader
    altitude_m: list[int]
    alt_pages: list[int]
    heartrate_bpm: list[int]
    hr_pages: list[int]
    hr_beats: list[int]
    laps: list[Lap]


def decode_log(device: object, header_page: int) -> DecodedLog:
    """Read header page + altitude + HR chains + laps for one log."""
    header_page_raw = read_page(device, header_page)
    header = parse_log_header(header_page_raw[:61])
    n = header.sample_count
    laps = parse_laps_from_header_page(header_page_raw, lap_count=header.lap_count)

    alt_chain = read_page_chain(device, altitude_start_page(header_page))
    alts = decode_altitude_with_resync(
        alt_chain,
        min_altitude_m=header.min_altitude_m,
        max_altitude_m=header.max_altitude_m,
        max_samples=n if n > 0 else None,
    )
    if n > 0 and len(alts) > n:
        alts = alts[:n]
    elif n > 0 and alts and 0 < n - len(alts) <= 8:
        alts = alts + [alts[-1]] * (n - len(alts))

    hr_chain = read_page_chain(device, hr_start_page(header_page))
    hr = decode_hr_from_pages(
        hr_chain,
        duration_s=header.duration_s,
        interval_s=header.sample_interval_s,
        sample_count=n if n > 0 else max(len(alts), 1),
    )
    # Align HR length to altitude / sample_count
    target = n if n > 0 else len(alts)
    bpm = list(hr.bpm)
    if target > 0:
        if len(bpm) < target and bpm:
            bpm = bpm + [bpm[-1]] * (target - len(bpm))
        elif len(bpm) < target:
            bpm = [0] * target
        else:
            bpm = bpm[:target]

    return DecodedLog(
        header_page=header_page,
        header=header,
        altitude_m=alts,
        alt_pages=[p for p, _ in alt_chain],
        heartrate_bpm=bpm,
        hr_pages=[p for p, _ in hr_chain],
        hr_beats=hr.beat_intervals_ms,
        laps=laps,
    )
