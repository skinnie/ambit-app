"""Heart-rate beat stream decoder (port of ``decode2`` from vendor/t6-0.5.c).

The T6 stores RR-like intervals in a bit-packed page chain. Words are
**big-endian** (``ntohs`` in the C code). The first word must be ``1``.

Converting beats → fixed-interval BPM (STM XML) is best-effort; Training Manager
applies its own averaging. We resample mean RR per sample window.
"""

from __future__ import annotations

from dataclasses import dataclass

# Special markers relative to maxpos = 2^(bitlen-1)-1
_SNONE = 99
_SMAX = 0
_SMAX1 = 1
_SMAX2 = 2
_SMAXM1 = 11
_SMAXM2 = 12


def bytes_to_be_words(data: bytes) -> list[int]:
    if len(data) % 2:
        data = data[:-1]
    return [int.from_bytes(data[i : i + 2], "big") for i in range(0, len(data), 2)]


def decode_beat_intervals(words: list[int], *, ends: int = 2) -> list[int]:
    """Return successive beat interval ticks (same units as t6-0.5.c ``time``).

    Tick unit appears to be **milliseconds** (sum of intervals ≈ session length
    in ms when the stream is truncated to session duration).
    """
    if not words or words[0] != 1:
        return []

    bitlen = 6
    wn = 1
    buffbits = 0
    bbuffer = 0
    oldabs = 0
    longabs = 0
    ndec = 0
    ended = 1
    beats: list[int] = []
    n = len(words)

    while True:
        maxpos = (1 << (bitlen - 1)) - 1
        while buffbits < bitlen:
            if wn >= n:
                return beats
            bbuffer |= words[wn] << buffbits
            wn += 1
            buffbits += 16

        samp = bbuffer & ((1 << bitlen) - 1)
        val = samp
        msb = (samp & (1 << (bitlen - 1))) >> (bitlen - 1)
        nmsb = (samp & (1 << (bitlen - 2))) >> (bitlen - 2)
        if msb:
            val = samp - (1 << bitlen)
        buffbits -= bitlen
        bbuffer >>= bitlen

        spec = _SNONE
        if samp == maxpos:
            spec = _SMAX
        elif samp == maxpos + 1:
            spec = _SMAX1
        elif samp == maxpos + 2:
            spec = _SMAX2
        elif samp == maxpos - 1:
            spec = _SMAXM1
        elif samp == maxpos - 2:
            spec = _SMAXM2

        isbeat = 0
        time = 0
        if spec == _SMAX:
            if wn >= n:
                return beats
            nextword = words[wn]
            wn += 1
            buffbits = 0
            bbuffer = 0
            oldabs = longabs & 0xFFFF
            longabs = nextword
            time = longabs - oldabs
            if time < 0:
                time += 0x10000
            isbeat = 0 if ended else 1
            ended = 0
            oldabs = longabs
        elif spec == _SMAXM1:
            bitlen += 1
            ndec = 0
        elif spec == _SMAX1:
            buffbits = 0
            bbuffer = 0
        else:
            if (msb == nmsb) and bitlen > 4:
                ndec += 1
                if ndec == 5:
                    bitlen -= 1
                    ndec = 0
            else:
                ndec = 0
            time = longabs - oldabs + val
            if time == -1:
                ends -= 1
                if ends <= 0:
                    return beats
                ended = 1
                isbeat = 0
            else:
                if time < 0:
                    time += 0x10000
                elif time > 0xFFFF:
                    time -= 0x10000
                if ended:
                    isbeat = 0
                    ended = 0
                else:
                    isbeat = 1
            oldabs = longabs
            longabs += time
        if isbeat:
            beats.append(time)


def trim_beats_to_duration(beats: list[int], duration_s: float) -> list[int]:
    """Keep beats until cumulative ms reaches session duration."""
    limit = int(round(duration_s * 1000))
    total = 0
    out: list[int] = []
    for beat in beats:
        if beat <= 0:
            continue
        total += beat
        out.append(beat)
        if total >= limit:
            break
    return out


def beats_to_interval_hr(
    beats: list[int],
    *,
    interval_s: int,
    sample_count: int,
    min_rr_ms: int = 300,
    max_rr_ms: int = 1500,
    method: str = "ewma",
    ewma_alpha: float = 0.01,
    rolling_window_s: int = 60,
    sample_phase: str = "end",
    backfill_first: bool = True,
) -> list[int | None]:
    """Resample beat intervals to fixed-period BPM values.

    Timeline rule: **all** beat intervals advance the clock. RR values outside
    ``[min_rr_ms, max_rr_ms]`` (e.g. 60000 gap markers) do **not** update the
    HR filter — they only hold the previous estimate. Dropping them from the
    stream (older code) compressed time and inflated error vs STM.

    Methods:
      * ``ewma`` — EWMA of instantaneous HR (default; α=0.01, sample at bin end,
        backfill first HR). Best fair mean MAE ~7.4 BPM on two T6d sessions
        with STM ground truth (was ~12 with prior defaults).
      * ``mean_rr`` — mean valid RR in each sample bin → 60000/mean_RR.
      * ``rolling`` — mean valid RR over the last *rolling_window_s* ending at
        sample time.

    *sample_phase*: ``start`` / ``mid`` / ``end`` of each ``interval_s`` bin.
    *backfill_first*: copy the first non-None estimate into leading samples
    (STM also fills pre-signal regions rather than zero).

    Returns one entry per sample; ``None`` means no estimate yet.
    """
    if interval_s <= 0 or sample_count <= 0:
        return []
    if not beats:
        return [None] * sample_count

    # Full timeline: (time_ms at end of interval, rr_or_None if valid for HR).
    events: list[tuple[float, int | None]] = []
    t = 0.0
    for beat in beats:
        t += beat
        if min_rr_ms <= beat <= max_rr_ms:
            events.append((t, beat))
        else:
            events.append((t, None))

    if method == "ewma":
        result = _sample_ewma(
            events,
            interval_s=interval_s,
            sample_count=sample_count,
            alpha=ewma_alpha,
            sample_phase=sample_phase,
        )
    elif method == "rolling":
        result = _sample_rolling(
            events,
            interval_s=interval_s,
            sample_count=sample_count,
            window_s=rolling_window_s,
            sample_phase=sample_phase,
        )
    else:
        # mean_rr (per sample bin, valid RR only)
        result = _sample_mean_rr_bins(
            events,
            interval_s=interval_s,
            sample_count=sample_count,
        )

    if backfill_first:
        result = _backfill_first(result)
    return result


def _phase_time_ms(index: int, interval_s: int, sample_phase: str) -> float:
    if sample_phase == "start":
        return index * interval_s * 1000.0
    if sample_phase == "mid":
        return (index + 0.5) * interval_s * 1000.0
    # end (default): HR for sample i represents state at end of bin i
    return (index + 1) * interval_s * 1000.0


def _backfill_first(values: list[int | None]) -> list[int | None]:
    """Fill leading Nones with the first real estimate (STM-like pre-signal fill)."""
    first: int | None = None
    for value in values:
        if value is not None:
            first = value
            break
    if first is None:
        return values
    out = list(values)
    for index, value in enumerate(out):
        if value is None:
            out[index] = first
        else:
            break
    return out


def _sample_ewma(
    events: list[tuple[float, int | None]],
    *,
    interval_s: int,
    sample_count: int,
    alpha: float,
    sample_phase: str = "end",
) -> list[int | None]:
    ewma: float | None = None
    ewma_at: list[tuple[float, float]] = []
    for time_ms, rr in events:
        if rr is not None:
            inst = 60000.0 / rr
            ewma = inst if ewma is None else alpha * inst + (1.0 - alpha) * ewma
        if ewma is not None:
            ewma_at.append((time_ms, ewma))
    result: list[int | None] = []
    k = 0
    for index in range(sample_count):
        t_s = _phase_time_ms(index, interval_s, sample_phase)
        while k + 1 < len(ewma_at) and ewma_at[k + 1][0] <= t_s:
            k += 1
        if not ewma_at or ewma_at[k][0] > t_s:
            result.append(None)
        else:
            result.append(int(round(ewma_at[k][1])))
    return result


def _sample_rolling(
    events: list[tuple[float, int | None]],
    *,
    interval_s: int,
    sample_count: int,
    window_s: int,
    sample_phase: str = "end",
) -> list[int | None]:
    times: list[float] = []
    rrs: list[int] = []
    for time_ms, rr in events:
        if rr is not None:
            times.append(time_ms)
            rrs.append(rr)
    result: list[int | None] = []
    j0 = 0
    for index in range(sample_count):
        t_end = _phase_time_ms(index, interval_s, sample_phase)
        t_start = t_end - window_s * 1000.0
        while j0 < len(times) and times[j0] <= t_start:
            j0 += 1
        win: list[int] = []
        j = j0
        while j < len(times) and times[j] <= t_end:
            win.append(rrs[j])
            j += 1
        if win:
            mean_rr = sum(win) / len(win)
            result.append(int(round(60000.0 / mean_rr)))
        else:
            result.append(None)
    return result


def _sample_mean_rr_bins(
    events: list[tuple[float, int | None]],
    *,
    interval_s: int,
    sample_count: int,
) -> list[int | None]:
    times: list[float] = []
    rrs: list[int] = []
    for time_ms, rr in events:
        if rr is not None:
            times.append(time_ms)
            rrs.append(rr)
    result: list[int | None] = []
    bi = 0
    for index in range(sample_count):
        t0 = index * interval_s * 1000.0
        t1 = t0 + interval_s * 1000.0
        while bi < len(times) and times[bi] <= t0:
            bi += 1
        bin_rrs: list[int] = []
        j = bi
        while j < len(times) and times[j] <= t1:
            bin_rrs.append(rrs[j])
            j += 1
        if bin_rrs:
            mean_rr = sum(bin_rrs) / len(bin_rrs)
            result.append(int(round(60000.0 / mean_rr)))
        else:
            result.append(None)
    return result


def fill_hold_last(values: list[int | None]) -> list[int]:
    """Replace None with previous HR (or 0 at start)."""
    out: list[int] = []
    last = 0
    for value in values:
        if value is None:
            out.append(last)
        else:
            last = value
            out.append(value)
    return out


@dataclass(frozen=True)
class HeartRateSeries:
    beat_intervals_ms: list[int]
    bpm: list[int]
