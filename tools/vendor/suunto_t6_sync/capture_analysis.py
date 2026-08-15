"""Rebuild memory and summarise a session from extracted DMS frames (JSONL)."""

from __future__ import annotations

import json
from collections import Counter
from dataclasses import dataclass
from pathlib import Path

from suunto_t6_sync.log_header import (
    LOCLOGH,
    T6D_LOG_HEADER_SIZE,
    page_to_address,
    parse_log_header,
    parse_log_page_directory,
)


@dataclass(frozen=True)
class MemoryRead:
    address: int
    requested_count: int
    data: bytes
    frame_offset: int


def _cmd(frame: dict) -> int:
    command = frame["command"]
    if isinstance(command, str):
        return int(command, 0)
    return int(command)


def _params(frame: dict) -> bytes:
    return bytes.fromhex(frame["parameters_hex"])


def load_frames_jsonl(path: Path) -> list[dict]:
    frames: list[dict] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line:
            frames.append(json.loads(line))
    return frames


def collect_memory_reads(frames: list[dict]) -> list[MemoryRead]:
    """Pair TX ReadMemory (0x05) with the following RX data frame when present.

    Response layout (confirmed)::

        05 | len_be | addr_hi addr_lo count | data… | crc

    Large requests (e.g. count ``0xC4``) often have **echo only** in Free Serial
    Analyzer captures — those are skipped (no data frame).
    """
    reads: list[MemoryRead] = []
    i = 0
    n = len(frames)
    while i < n:
        frame = frames[i]
        if frame.get("direction") != "tx" or _cmd(frame) != 0x05:
            i += 1
            continue
        params = _params(frame)
        if len(params) != 3:
            i += 1
            continue
        address = (params[0] << 8) | params[1]
        count = params[2]
        data_body: bytes | None = None
        for j in range(i + 1, min(i + 8, n)):
            other = frames[j]
            if other.get("direction") == "tx":
                break
            if _cmd(other) != 0x05 or other.get("direction") != "rx":
                continue
            rp = _params(other)
            if len(rp) <= 3:
                continue  # echo of request only
            if rp[0] == params[0] and rp[1] == params[1] and rp[2] == count:
                data_body = rp[3:]
                break
        if data_body is not None:
            reads.append(
                MemoryRead(
                    address=address,
                    requested_count=count,
                    data=data_body,
                    frame_offset=int(frame["offset"]),
                )
            )
        i += 1
    return reads


def rebuild_memory(reads: list[MemoryRead]) -> dict[int, int]:
    """Sparse address → byte map (later reads overwrite earlier)."""
    mem: dict[int, int] = {}
    for read in reads:
        for index, value in enumerate(read.data):
            mem[read.address + index] = value
    return mem


def slice_memory(mem: dict[int, int], start: int, length: int) -> bytes | None:
    if any(start + i not in mem for i in range(length)):
        return None
    return bytes(mem[start + i] for i in range(length))


def format_analysis_report(frames: list[dict], reads: list[MemoryRead]) -> str:
    lines: list[str] = []
    lines.append("# Capture analysis")
    lines.append("")
    by_cmd = Counter(_cmd(f) for f in frames)
    by_dir = Counter(str(f.get("direction")) for f in frames)
    lines.append(f"- frames: {len(frames)}")
    lines.append(f"- by direction: {dict(sorted(by_dir.items()))}")
    lines.append(
        "- by command: "
        + ", ".join(f"0x{cmd:02x}×{count}" for cmd, count in sorted(by_cmd.items()))
    )
    lines.append(f"- ReadMemory responses with data: {len(reads)}")
    tx_reads = [
        f
        for f in frames
        if f.get("direction") == "tx" and _cmd(f) == 0x05 and len(_params(f)) == 3
    ]
    lines.append(f"- ReadMemory TX requests: {len(tx_reads)}")
    lines.append(
        f"- ReadMemory TX without data response: {len(tx_reads) - len(reads)} "
        "(often large 0xC4 chunks missing from free-tier .dmslog8)"
    )
    lines.append("")

    mem = rebuild_memory(reads)

    loc = slice_memory(mem, LOCLOGH, 30)
    lines.append("## Log page directory (LOCLOGH @ 0x0FB4)")
    if loc is None:
        lines.append("- not fully present in capture data responses")
    else:
        pages = parse_log_page_directory(loc)
        lines.append(f"- raw: {loc.hex(' ')}")
        lines.append(f"- pages: {[f'0x{p:02x}' for p in pages]}")
        for page in pages:
            addr = page_to_address(page)
            lines.append(f"- page 0x{page:02x} → PADDR 0x{addr:04x}")
    lines.append("")

    lines.append("## Log headers (61-byte STM reads)")
    header_addrs = sorted(
        {r.address for r in reads if r.requested_count == T6D_LOG_HEADER_SIZE}
    )
    # Also try directory-derived addresses
    if loc is not None:
        for page in parse_log_page_directory(loc):
            addr = page_to_address(page)
            if addr not in header_addrs:
                header_addrs.append(addr)
        header_addrs = sorted(set(header_addrs))

    for addr in header_addrs:
        blob = slice_memory(mem, addr, T6D_LOG_HEADER_SIZE)
        if blob is None:
            # try exact read
            for read in reads:
                if read.address == addr and len(read.data) >= 28:
                    blob = read.data[:T6D_LOG_HEADER_SIZE]
                    break
        if blob is None:
            lines.append(f"- 0x{addr:04x}: incomplete")
            continue
        try:
            header = parse_log_header(blob)
        except ValueError as exc:
            lines.append(f"- 0x{addr:04x}: parse error ({exc})")
            continue
        lines.append(
            f"- 0x{addr:04x}: start={header.start.isoformat(sep=' ')} "
            f"interval={header.sample_interval_s}s "
            f"alt=[{header.min_altitude_m}, {header.max_altitude_m}] m "
            f"({len(blob)} bytes)"
        )
    lines.append("")

    lines.append("## Identity / misc reads")
    for addr, count in ((0x005A, 4), (0x00F0, 3), (0x0064, 48), (0x00B4, 9)):
        blob = slice_memory(mem, addr, count)
        if blob is None:
            for read in reads:
                if read.address == addr:
                    blob = read.data
                    break
        lines.append(
            f"- 0x{addr:04x}×{count}: {blob.hex(' ') if blob is not None else 'missing'}"
        )
    lines.append("")

    lines.append("## Commands 0x0e / 0x10")
    for frame in frames:
        if _cmd(frame) in (0x0E, 0x10):
            lines.append(
                f"- {frame.get('direction')} 0x{_cmd(frame):02x} "
                f"params={frame.get('parameters_hex')!r}"
            )
    lines.append("")
    return "\n".join(lines) + "\n"


def analyze_jsonl(path: Path) -> str:
    frames = load_frames_jsonl(path)
    reads = collect_memory_reads(frames)
    return format_analysis_report(frames, reads)


def write_memory_blob(reads: list[MemoryRead], out_path: Path) -> int:
    """Write a dense blob from min..max reconstructed address (0xFF fill gaps)."""
    mem = rebuild_memory(reads)
    if not mem:
        out_path.write_bytes(b"")
        return 0
    lo = min(mem)
    hi = max(mem)
    blob = bytes(mem.get(lo + i, 0xFF) for i in range(hi - lo + 1))
    out_path.write_bytes(blob)
    return len(blob)
