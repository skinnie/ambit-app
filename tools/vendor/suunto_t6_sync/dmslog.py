"""Extract Suunto D9-style frames from HHD Free Serial Analyzer ``.dmslog8`` files.

The ``.dmslog8`` container is proprietary (and free-tier export is locked). This module
does **not** fully reverse the container; it scans the blob for valid D9 frames
(command + BE length + parameters + XOR checksum) and classifies direction using the
IRP-style flags that appear just before each embedded payload in captures from
Device Monitoring Studio / Free Serial Analyzer.

Observed layout immediately before a framed payload (from
``stm-sync-20260806-103105.dmslog8``)::

    [flags: u32 LE]          bit31 set  → completion / UP  (device→host side)
                             bit31 clear → DOWN             (host→device side)
    [FILETIME: u64 LE]       high dword in ~0x01d0_0000..0x01e0_0000 for 2020s
    [9-byte sub-header]      often includes a LE length (frequently wrong/truncated
                             in free logs — do not trust for framing)
    [serial payload…]        D9 frame(s)

Host commands usually appear as a short DOWN frame; the device reply is a longer
UP frame with the same command byte and a non-zero parameter length (after a
possible UP echo of the request).
"""

from __future__ import annotations

import json
import struct
from collections.abc import Iterable
from dataclasses import asdict, dataclass
from enum import StrEnum
from pathlib import Path

from suunto_t6_sync.protocol import Packet, try_parse_frame

# Commands seen on T6d STM 2.3.0 traffic (expand as captures warrant).
DEFAULT_COMMANDS: frozenset[int] = frozenset(
    {
        0x05,  # ReadMemory
        0x06,  # WriteMemory (should not appear in read-only sync)
        0x0E,  # seen in T6d capture (identity TBD)
        0x0F,  # GetVersion
        0x10,  # seen in T6d capture (identity TBD)
    }
)

# Windows FILETIME high dword for ~2020–2027 wall times (coarse filter).
_FILETIME_HIGH_MIN = 0x01D00000
_FILETIME_HIGH_MAX = 0x01E00000


class Direction(StrEnum):
    TX = "tx"  # host → device (IRP down)
    RX = "rx"  # device → host (IRP up / completion)
    UNKNOWN = "unknown"


@dataclass(frozen=True)
class ExtractedFrame:
    offset: int
    direction: Direction
    command: int
    parameters: bytes
    raw: bytes
    irp_flags: int | None

    @property
    def param_length(self) -> int:
        return len(self.parameters)

    def to_json_dict(self) -> dict:
        d = asdict(self)
        d["direction"] = self.direction.value
        d["parameters_hex"] = self.parameters.hex()
        d["raw_hex"] = self.raw.hex()
        d["command"] = f"0x{self.command:02x}"
        del d["parameters"]
        del d["raw"]
        return d


def _filetime_high_ok(value: int) -> bool:
    return _FILETIME_HIGH_MIN <= value <= _FILETIME_HIGH_MAX


def classify_direction(blob: bytes, frame_offset: int) -> tuple[Direction, int | None]:
    """Return direction and IRP flags u32 if the DMS context pattern matches."""
    if frame_offset < 21:
        return Direction.UNKNOWN, None
    flags = struct.unpack_from("<I", blob, frame_offset - 21)[0]
    ft_high = struct.unpack_from("<I", blob, frame_offset - 13)[0]
    if not _filetime_high_ok(ft_high):
        return Direction.UNKNOWN, flags
    if flags & 0x8000_0000:
        return Direction.RX, flags
    return Direction.TX, flags


def iter_d9_frames(
    blob: bytes,
    *,
    commands: Iterable[int] | None = None,
) -> Iterable[tuple[int, Packet, bytes]]:
    """Yield ``(offset, packet, raw_frame)`` for every valid D9 frame in *blob*."""
    allowed = frozenset(commands) if commands is not None else DEFAULT_COMMANDS
    i = 0
    n = len(blob)
    while i < n - 3:
        if blob[i] not in allowed:
            i += 1
            continue
        parsed = try_parse_frame(blob, i)
        if parsed is None:
            i += 1
            continue
        packet, raw = parsed
        yield i, packet, raw
        # Advance past this frame to avoid re-matching inside parameters.
        i += len(raw)


def extract_frames(
    blob: bytes,
    *,
    commands: Iterable[int] | None = None,
    require_context: bool = False,
) -> list[ExtractedFrame]:
    """Extract and classify frames from a ``.dmslog8`` (or any) byte blob."""
    out: list[ExtractedFrame] = []
    for offset, packet, raw in iter_d9_frames(blob, commands=commands):
        direction, flags = classify_direction(blob, offset)
        if require_context and direction is Direction.UNKNOWN:
            continue
        out.append(
            ExtractedFrame(
                offset=offset,
                direction=direction,
                command=packet.command,
                parameters=packet.parameters,
                raw=raw,
                irp_flags=flags,
            )
        )
    return out


def extract_file(
    path: Path,
    *,
    commands: Iterable[int] | None = None,
    require_context: bool = False,
) -> list[ExtractedFrame]:
    return extract_frames(
        path.read_bytes(),
        commands=commands,
        require_context=require_context,
    )


def write_outputs(
    frames: list[ExtractedFrame],
    out_dir: Path,
    *,
    stem: str = "extracted",
) -> dict[str, Path]:
    """Write timeline, JSONL, and direction-split raw concatenations.

    Returns a map of artifact name → path.
    """
    out_dir.mkdir(parents=True, exist_ok=True)
    paths: dict[str, Path] = {}

    jsonl_path = out_dir / f"{stem}.jsonl"
    with jsonl_path.open("w", encoding="utf-8") as fh:
        for frame in frames:
            fh.write(json.dumps(frame.to_json_dict(), sort_keys=True) + "\n")
    paths["jsonl"] = jsonl_path

    timeline_path = out_dir / f"{stem}.timeline.txt"
    with timeline_path.open("w", encoding="utf-8") as fh:
        fh.write(
            "# offset  dir  flags      cmd  params_len  raw_hex\n"
        )
        for frame in frames:
            flags = f"0x{frame.irp_flags:08x}" if frame.irp_flags is not None else "-"
            fh.write(
                f"{frame.offset:8d}  {frame.direction.value:7s}  {flags:>10s}  "
                f"0x{frame.command:02x}  {frame.param_length:3d}  {frame.raw.hex(' ')}\n"
            )
    paths["timeline"] = timeline_path

    for direction, name in (
        (Direction.TX, "tx"),
        (Direction.RX, "rx"),
        (Direction.UNKNOWN, "unknown"),
    ):
        chunk = b"".join(f.raw for f in frames if f.direction is direction)
        path = out_dir / f"{stem}.{name}.bin"
        path.write_bytes(chunk)
        paths[name] = path

    # Host commands only: TX frames (DOWN IRPs). Device replies live in RX.
    summary_path = out_dir / f"{stem}.summary.txt"
    by_cmd: dict[int, int] = {}
    by_dir: dict[str, int] = {}
    for frame in frames:
        by_cmd[frame.command] = by_cmd.get(frame.command, 0) + 1
        by_dir[frame.direction.value] = by_dir.get(frame.direction.value, 0) + 1
    with summary_path.open("w", encoding="utf-8") as fh:
        fh.write(f"frames: {len(frames)}\n")
        fh.write("by_direction:\n")
        for key, count in sorted(by_dir.items()):
            fh.write(f"  {key}: {count}\n")
        fh.write("by_command:\n")
        for cmd, count in sorted(by_cmd.items()):
            fh.write(f"  0x{cmd:02x}: {count}\n")
    paths["summary"] = summary_path
    return paths
