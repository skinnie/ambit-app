"""Export decoded sessions to Suunto Training Manager XML or structured JSON."""

from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any, Literal
from xml.sax.saxutils import escape

from suunto_t6_sync.decoder import DecodedLog
from suunto_t6_sync.lap_decode import Lap
from suunto_t6_sync.log_header import LogHeader

ExportFormat = Literal["xml", "json"]


def format_stm_datetime(dt: datetime) -> str:
    """STM style: ``DD.MM.YYYY HH:MM:SS``."""
    return dt.strftime("%d.%m.%Y %H:%M:%S")


def format_iso_utc(dt: datetime) -> str:
    """Convert naive watch wall-clock time to ISO UTC.

    Treat STM-style wall-clock datetimes as local machine time, then emit Zulu
    (same convention many STM importers use when parsing XML dates).
    """
    if dt.tzinfo is None:
        aware = dt.astimezone()
    else:
        aware = dt
    utc = aware.astimezone(UTC)
    # Match JS Date#toISOString: milliseconds + Z
    return utc.strftime("%Y-%m-%dT%H:%M:%S.") + f"{utc.microsecond // 1000:03d}Z"


def format_duration(seconds: float) -> str:
    """Format duration like STM exports (one decimal when needed)."""
    if abs(seconds - round(seconds)) < 1e-6:
        return str(int(round(seconds)))
    return f"{seconds:.1f}"


def compute_ascent_descent(altitudes_m: list[int]) -> tuple[int, int]:
    """Sum positive / negative altitude steps (metres)."""
    ascent = 0
    descent = 0
    for previous, current in zip(altitudes_m, altitudes_m[1:]):
        delta = current - previous
        if delta > 0:
            ascent += delta
        elif delta < 0:
            descent += -delta
    return ascent, descent


def _qty(value: float | int, unit: str) -> dict[str, Any]:
    """QuantityDTO-shaped object: ``{value, unit}``."""
    return {"value": value, "unit": unit}


def _align_series(
    header: LogHeader,
    altitudes_m: list[int],
    heartrates_bpm: list[int | None] | None,
) -> tuple[list[int], list[int | None], int]:
    """Pad/truncate altitude and HR series to header sample count."""
    n = header.sample_count
    if n <= 0:
        n = max(len(altitudes_m), 1)
    hrs: list[int | None] = list(heartrates_bpm or [])
    alts = list(altitudes_m)
    while len(alts) < n:
        alts.append(alts[-1] if alts else 0)
    while len(hrs) < n:
        hrs.append(hrs[-1] if hrs else None)
    return alts[:n], hrs[:n], n


def _series_meta(
    header: LogHeader,
    alts: list[int],
    hrs: list[int | None],
) -> tuple[int, int, int, int, int, int, int]:
    """Return tot_asc, tot_desc, asc_time, dsc_time, min_hr, max_hr, avg_hr."""
    hr_vals = [h for h in hrs if h is not None and h > 0]
    avg_hr = int(round(sum(hr_vals) / len(hr_vals))) if hr_vals else 0
    min_hr = min(hr_vals) if hr_vals else 0
    max_hr = max(hr_vals) if hr_vals else 0
    series_asc, series_desc = compute_ascent_descent(alts)
    tot_asc = header.total_ascent_m if header.total_ascent_m else series_asc
    tot_desc = header.total_descent_m if header.total_descent_m else series_desc
    return (
        tot_asc,
        tot_desc,
        header.ascent_time_s,
        header.descent_time_s,
        min_hr,
        max_hr,
        avg_hr,
    )


def format_lap_duration(seconds: float) -> str:
    """Lap duration / logtime like STM (one decimal when needed)."""
    return format_duration(seconds)


def build_training_manager_xml(
    header: LogHeader,
    *,
    altitudes_m: list[int],
    heartrates_bpm: list[int | None] | None = None,
    wristop_id: str = "14800205",
    laps: list[Lap] | None = None,
) -> str:
    """Build a ``<SUUNTO><MSG>…`` document from decoded series."""
    interval = header.sample_interval_s
    alts, hrs, n = _align_series(header, altitudes_m, heartrates_bpm)
    start = header.start
    tot_asc, tot_desc, asc_time, dsc_time, min_hr, max_hr, avg_hr = _series_meta(
        header, alts, hrs
    )

    # Meta tags commonly present in STM exports (defaults where device has none).
    lines: list[str] = [
        '<?xml version="1.0" encoding="ISO-8859-15" ?>',
        "<SUUNTO>",
        "<HEADER><MSGNAME>R6005A</MSGNAME> </HEADER>",
        "<MSG>",
        f"<WRISTOPID>{escape(wristop_id)}</WRISTOPID>",
        f"<LOGTITLE>{escape(start.strftime('%d/%m/%Y %H.%M.%S'))}</LOGTITLE>",
        "<LOGNOTES></LOGNOTES>",
        f"<STARTTIME>{format_stm_datetime(start)}</STARTTIME>",
        f"<SAMPLEINTERVAL>{interval}</SAMPLEINTERVAL>",
        f"<DURATION>{format_duration(header.duration_s)}</DURATION>",
        f"<MINALT>{header.min_altitude_m}</MINALT>",
        f"<MAXALT>{header.max_altitude_m}</MAXALT>",
        f"<MINHR>{min_hr}</MINHR>",
        f"<MAXHR>{max_hr}</MAXHR>",
        "<MAXSPEED>0</MAXSPEED>",
        "<AVGSPEED>0</AVGSPEED>",
        "<AVGCADENCE>0</AVGCADENCE>",
        f"<AVGHR>{avg_hr}</AVGHR>",
        "<MINTEMP>0</MINTEMP>",
        "<MAXTEMP>0</MAXTEMP>",
        f"<TOTASC>{tot_asc}</TOTASC>",
        f"<TOTDESC>{tot_desc}</TOTDESC>",
        f"<ASCTIME>{asc_time}</ASCTIME>",
        f"<DSCTIME>{dsc_time}</DSCTIME>",
        "<DISTANCE>0</DISTANCE>",
        "<ACTIVITYID>0</ACTIVITYID>",
        "<LOGTYPE>3</LOGTYPE>",
        "<FEELING>0</FEELING>",
        "<PERSONAL_WEIGHT>70</PERSONAL_WEIGHT>",
        "<HRZONE1>100</HRZONE1>",
        "<HRZONE2>120</HRZONE2>",
        "<HRZONE3>140</HRZONE3>",
        "<HRZONE4>160</HRZONE4>",
        "<HRZONE5>180</HRZONE5>",
        "<HRLIMITLOW>125</HRLIMITLOW>",
        "<HRLIMITHIGH>165</HRLIMITHIGH>",
    ]

    for index in range(n):
        sample_time = start + timedelta(seconds=index * interval)
        st = index * interval
        hr = hrs[index]
        alt = alts[index]
        hr_xml = f"<HR>{hr}</HR>" if hr is not None else "<HR>0</HR>"
        lines.append(
            f"<SAMPLE>"
            f"<TM>{format_stm_datetime(sample_time)}</TM>"
            f"{hr_xml}"
            f"<ST>{st}</ST>"
            f"<ALT>{alt}</ALT>"
            f"</SAMPLE>"
        )

    for lap in laps or []:
        # STM LAP tags
        lines.append(
            "<LAP>"
            f"<L_SP>{format_lap_duration(lap.duration_s)}</L_SP>"
            f"<L_ST>{format_lap_duration(lap.logtime_s)}</L_ST>"
            f"<L_ALT>{lap.altitude_m}</L_ALT>"
            f"<L_ASC>{lap.ascent_m}</L_ASC>"
            f"<L_DESC>{lap.descent_m}</L_DESC>"
            "<L_NT></L_NT>"
            f"<L_HR>{lap.heartrate}</L_HR>"
            f"<L_HRAVG>{lap.heartrate_avg}</L_HRAVG>"
            "</LAP>"
        )

    lines.append("</MSG>")
    lines.append("</SUUNTO>")
    lines.append("")
    return "\n".join(lines)


def build_training_log_dto(
    header: LogHeader,
    *,
    altitudes_m: list[int],
    heartrates_bpm: list[int | None] | None = None,
    wristop_id: str = "14800205",
    laps: list[Lap] | None = None,
) -> dict[str, Any]:
    """Build structured session JSON (alternative to the XML path).

    Quantity fields use ``{value, unit}`` objects; datetimes are ISO UTC.
    See ``docs/output-format.md``.
    """
    interval = header.sample_interval_s
    alts, hrs, n = _align_series(header, altitudes_m, heartrates_bpm)
    start = header.start
    tot_asc, tot_desc, asc_time, dsc_time, min_hr, max_hr, avg_hr = _series_meta(
        header, alts, hrs
    )
    try:
        device_id: int | str = int(wristop_id)
    except ValueError:
        device_id = wristop_id

    meta: dict[str, Any] = {
        "start": format_iso_utc(start),
        "logType": 3,
        "activityId": 0,
        "title": start.strftime("%d/%m/%Y %H.%M.%S"),
        "notes": "",
        "feeling": 0,
        "userWeight": _qty(70, "kg"),
        "deviceId": device_id,
        "sampleInterval": _qty(interval, "s"),
        "hrZone1": _qty(100, "bpm"),
        "hrZone2": _qty(120, "bpm"),
        "hrZone3": _qty(140, "bpm"),
        "hrZone4": _qty(160, "bpm"),
        "hrZone5": _qty(180, "bpm"),
        "hrLimitLow": _qty(125, "bpm"),
        "hrLimitHigh": _qty(165, "bpm"),
        "duration": _qty(header.duration_s, "s"),
        "temperatureMin": _qty(0, "tempC"),
        "temperatureMax": _qty(0, "tempC"),
        "altitudeMin": _qty(header.min_altitude_m, "m"),
        "altitudeMax": _qty(header.max_altitude_m, "m"),
        "ascent": _qty(tot_asc, "m"),
        "descent": _qty(tot_desc, "m"),
        "ascentTime": _qty(asc_time, "s"),
        "descentTime": _qty(dsc_time, "s"),
        "distance": _qty(0, "m"),
        "speedAvg": _qty(0, "km/h"),
        "speedMax": _qty(0, "km/h"),
        "cadenceAvg": _qty(0, "rpm"),
    }
    if min_hr or max_hr or avg_hr:
        meta["heartrateMin"] = _qty(min_hr, "bpm")
        meta["heartrateMax"] = _qty(max_hr, "bpm")
        meta["heartrateAvg"] = _qty(avg_hr, "bpm")

    samples: list[dict[str, Any]] = []
    for index in range(n):
        sample_time = start + timedelta(seconds=index * interval)
        sample: dict[str, Any] = {
            "datetime": format_iso_utc(sample_time),
            "altitude": _qty(alts[index], "m"),
            "logtime": _qty(index * interval, "s"),
        }
        hr = hrs[index]
        if hr is not None:
            sample["heartrate"] = _qty(hr, "bpm")
        samples.append(sample)

    lap_dtos: list[dict[str, Any]] = []
    for lap in laps or []:
        lap_dtos.append(
            {
                "time": _qty(lap.duration_s, "s"),
                "timefromstart": _qty(lap.logtime_s, "s"),
                "altitude": _qty(lap.altitude_m, "m"),
                "ascent": _qty(lap.ascent_m, "m"),
                "descent": _qty(lap.descent_m, "m"),
                "note": "",
                "heartrate": _qty(lap.heartrate, "bpm"),
            }
        )

    result: dict[str, Any] = {
        "isOverview": False,
        "logId": header.log_id(),
        "meta": meta,
        "samples": samples,
    }
    if lap_dtos:
        result["laps"] = lap_dtos
    return result


def existing_export_path(
    out_dir: Path,
    log_id: str,
    fmt: ExportFormat = "xml",
) -> Path | None:
    """Return path if ``{logId}.{ext}`` already exists in *out_dir*, else None."""
    path = out_dir / f"{log_id}.{fmt}"
    return path if path.is_file() else None


DEVICE_SIDECAR_NAME = "device.json"


def write_device_identity_sidecar(
    out_dir: Path,
    identity_props: dict[str, str],
    *,
    force: bool = True,
) -> Path:
    """Write ``device.json`` (manufacturer / model / hardwareId / firmwareVersion)."""
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / DEVICE_SIDECAR_NAME
    if path.is_file() and not force:
        return path
    path.write_text(
        json.dumps(identity_props, indent=2, ensure_ascii=False, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    return path


def write_beats_sidecar(decoded: DecodedLog, export_path: Path) -> Path | None:
    """Write raw beat intervals (ms) next to an export. Returns path or None."""
    if not decoded.hr_beats:
        return None
    path = export_path.with_suffix(".beats.txt")
    path.write_text(
        "\n".join(str(b) for b in decoded.hr_beats) + "\n",
        encoding="utf-8",
    )
    return path


def export_decoded_log(
    decoded: DecodedLog,
    out_dir: Path,
    *,
    wristop_id: str = "14800205",
    write_beats: bool = False,
    fmt: ExportFormat = "xml",
    force: bool = False,
) -> tuple[Path, bool]:
    """Write one log as XML or JSON; return ``(path, written)``.

    If the target file already exists and *force* is False, skip the write and
    return ``(path, False)`` for incremental sync. Beat sidecars are optional.
    """
    if fmt not in ("xml", "json"):
        raise ValueError(f"unsupported format: {fmt}")

    out_dir.mkdir(parents=True, exist_ok=True)
    log_id = decoded.header.log_id()
    path = out_dir / f"{log_id}.{fmt}"
    if path.is_file() and not force:
        return path, False

    if fmt == "xml":
        content = build_training_manager_xml(
            decoded.header,
            altitudes_m=decoded.altitude_m,
            heartrates_bpm=decoded.heartrate_bpm,
            wristop_id=wristop_id,
            laps=decoded.laps,
        )
        path.write_text(content, encoding="latin-1")
    else:
        dto = build_training_log_dto(
            decoded.header,
            altitudes_m=decoded.altitude_m,
            heartrates_bpm=decoded.heartrate_bpm,
            wristop_id=wristop_id,
            laps=decoded.laps,
        )
        path.write_text(
            json.dumps(dto, indent=2, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )

    if write_beats:
        write_beats_sidecar(decoded, path)
    return path, True
