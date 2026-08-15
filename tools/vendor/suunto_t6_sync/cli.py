"""CLI entry point for suunto-t6-sync."""

from __future__ import annotations

import sys
from enum import IntEnum
from pathlib import Path

import typer
from rich.console import Console

from suunto_t6_sync import __version__
from suunto_t6_sync.capture_analysis import (
    analyze_jsonl,
    collect_memory_reads,
    load_frames_jsonl,
    write_memory_blob,
)
from suunto_t6_sync.device import SuuntoDevice
from suunto_t6_sync.dmslog import extract_file, write_outputs
from suunto_t6_sync.exporter import (
    ExportFormat,
    existing_export_path,
    write_device_identity_sidecar,
)
from suunto_t6_sync.log_header import page_to_address
from suunto_t6_sync.transport import ProtocolError, SerialTransport

app = typer.Typer(
    name="suunto-t6-sync",
    help="Download Suunto T6 training logs on Linux without Training Manager.",
    no_args_is_help=True,
)
console = Console()


class ExitCode(IntEnum):
    OK = 0
    DEVICE = 1
    PROTOCOL = 2
    DECODE = 3
    EXPORT = 4
    USAGE = 5


def _version_callback(value: bool) -> None:
    if value:
        console.print(f"suunto-t6-sync {__version__}")
        raise typer.Exit()


def _require_device(path: str) -> None:
    if not Path(path).exists():
        console.print(f"[red]Device not found: {path}[/red]")
        console.print(
            "[dim]Detach USB from the Win11 VM if passthrough is active "
            "(lsusb | grep -i suunto).[/dim]"
        )
        raise typer.Exit(ExitCode.DEVICE)


@app.callback()
def main(
    version: bool = typer.Option(
        False,
        "--version",
        "-V",
        callback=_version_callback,
        is_eager=True,
        help="Show version and exit.",
    ),
) -> None:
    """Suunto T6 backup CLI."""


@app.command("probe")
def probe(
    device: str = typer.Option("/dev/ttyUSB0", "--device", help="Serial device path."),
    baud: int = typer.Option(115200, "--baud", help="Serial baud rate."),
    verbose: bool = typer.Option(False, "--verbose", "-v", help="Verbose logging."),
) -> None:
    """Open the port, print model/serial/firmware + log count (read-only)."""
    _require_device(device)
    try:
        with SerialTransport(device, baudrate=baud) as transport:
            if verbose:
                console.print(f"[dim]Opened {device} @ {baud} 8N1[/dim]")
            # Always probe 0x0E/0x10 for identity fingerprint.
            identity = SuuntoDevice(transport).get_identity(extra_commands=True)
    except typer.Exit:
        raise
    except OSError as exc:
        console.print(f"[red]Serial error: {exc}[/red]")
        raise typer.Exit(ExitCode.DEVICE) from exc
    except ProtocolError as exc:
        console.print(f"[red]Protocol error: {exc}[/red]")
        raise typer.Exit(ExitCode.PROTOCOL) from exc
    except ValueError as exc:
        console.print(f"[red]Identity decode error: {exc}[/red]")
        raise typer.Exit(ExitCode.DECODE) from exc

    ver = identity.version
    console.print(f"[green]Model[/green] {identity.model}")
    console.print(f"[green]GetVersion[/green] raw={ver.raw.hex(' ')}")
    if ver.firmware_hint:
        console.print(f"  firmware: {ver.firmware_hint}")
    if ver.product_byte is not None:
        console.print(f"  product byte: 0x{ver.product_byte:02x}")
    console.print(
        f"[green]Serial[/green] {identity.serial} "
        f"(LOCSER {identity.serial_raw.hex(' ')})"
    )
    console.print(
        f"layout: {identity.layout_class} "
        f"(log header {identity.log_header_size} bytes)"
    )
    console.print(f"logs on device: {identity.log_count}")
    if verbose:
        if identity.cmd_0e is not None:
            console.print(f"  cmd 0x0e → {identity.cmd_0e.hex(' ')}")
        if identity.cmd_0x10 is not None:
            console.print(f"  cmd 0x10 → {identity.cmd_0x10.hex(' ')}")
    raise typer.Exit(ExitCode.OK)


@app.command("get-version")
def get_version_cmd(
    device: str = typer.Option("/dev/ttyUSB0", "--device", help="Serial device path."),
    baud: int = typer.Option(115200, "--baud", help="Serial baud rate."),
) -> None:
    """Send GetVersion (0x0F) and print the response."""
    _require_device(device)
    try:
        with SerialTransport(device, baudrate=baud) as transport:
            ver = SuuntoDevice(transport).get_version()
    except OSError as exc:
        console.print(f"[red]Serial error: {exc}[/red]")
        raise typer.Exit(ExitCode.DEVICE) from exc
    except ProtocolError as exc:
        console.print(f"[red]Protocol error: {exc}[/red]")
        raise typer.Exit(ExitCode.PROTOCOL) from exc
    console.print(ver.raw.hex(" "))
    if ver.firmware_hint:
        console.print(f"firmware hint: {ver.firmware_hint}")
    raise typer.Exit(ExitCode.OK)


@app.command("read-memory")
def read_memory_cmd(
    address: str = typer.Argument(..., help="Start address (hex, e.g. 0x0fb4 or 0fb4)."),
    count: int = typer.Argument(..., min=1, help="Number of bytes to read."),
    device: str = typer.Option("/dev/ttyUSB0", "--device", help="Serial device path."),
    baud: int = typer.Option(115200, "--baud", help="Serial baud rate."),
    output: Path | None = typer.Option(
        None,
        "--output",
        "-o",
        help="Write raw bytes to file (default: hex dump on stdout).",
    ),
) -> None:
    """Read device memory (read-only ReadMemory 0x05)."""
    _require_device(device)
    try:
        addr = int(address, 0) if address.lower().startswith("0x") else int(address, 16)
    except ValueError:
        console.print(f"[red]Invalid address: {address}[/red]")
        raise typer.Exit(ExitCode.USAGE) from None
    try:
        with SerialTransport(device, baudrate=baud) as transport:
            data = SuuntoDevice(transport).read_memory(addr, count)
    except OSError as exc:
        console.print(f"[red]Serial error: {exc}[/red]")
        raise typer.Exit(ExitCode.DEVICE) from exc
    except (ProtocolError, ValueError) as exc:
        console.print(f"[red]Protocol error: {exc}[/red]")
        raise typer.Exit(ExitCode.PROTOCOL) from exc

    if output is not None:
        output.write_bytes(data)
        console.print(f"[green]Wrote {len(data)} bytes → {output}[/green]")
    else:
        for off in range(0, len(data), 16):
            chunk = data[off : off + 16]
            hexs = " ".join(f"{b:02x}" for b in chunk)
            console.print(f"{addr + off:04x}: {hexs}")
    raise typer.Exit(ExitCode.OK)


@app.command("list-logs")
def list_logs_cmd(
    device: str = typer.Option("/dev/ttyUSB0", "--device", help="Serial device path."),
    baud: int = typer.Option(115200, "--baud", help="Serial baud rate."),
    verbose: bool = typer.Option(False, "--verbose", "-v", help="Show header hex."),
) -> None:
    """List training logs (directory @ 0x0FB4 + 61-byte headers)."""
    _require_device(device)
    try:
        with SerialTransport(device, baudrate=baud) as transport:
            logs = SuuntoDevice(transport).list_logs()
    except OSError as exc:
        console.print(f"[red]Serial error: {exc}[/red]")
        raise typer.Exit(ExitCode.DEVICE) from exc
    except ProtocolError as exc:
        console.print(f"[red]Protocol error: {exc}[/red]")
        raise typer.Exit(ExitCode.PROTOCOL) from exc

    if not logs:
        console.print("[yellow]No logs found on device.[/yellow]")
        raise typer.Exit(ExitCode.OK)

    for log in logs:
        h = log.header
        console.print(
            f"[{log.index}] page=0x{log.page:02x} addr=0x{log.address:04x} "
            f"start={h.start.isoformat(sep=' ')} "
            f"duration={h.duration_s}s interval={h.sample_interval_s}s "
            f"samples={h.sample_count} laps={h.lap_count} "
            f"alt=[{h.min_altitude_m}, {h.max_altitude_m}] m"
        )
        if verbose:
            console.print(f"     header: {h.raw.hex(' ')}")
    raise typer.Exit(ExitCode.OK)


@app.command("dump-log")
def dump_log_cmd(
    log_index: int = typer.Argument(..., min=0, help="Log index from list-logs."),
    device: str = typer.Option("/dev/ttyUSB0", "--device", help="Serial device path."),
    baud: int = typer.Option(115200, "--baud", help="Serial baud rate."),
    out_dir: Path = typer.Option(
        Path("fixtures/captures/live-dump"),
        "--out-dir",
        help="Directory for dump artifacts.",
    ),
) -> None:
    """Dump one log: header, altitude, HR, and optional XML (read-only)."""
    _require_device(device)
    try:
        with SerialTransport(device, baudrate=baud, timeout=3.0) as transport:
            dev = SuuntoDevice(transport)
            decoded = dev.decode_log_by_index(log_index)
    except IndexError as exc:
        console.print(f"[red]{exc}[/red]")
        raise typer.Exit(ExitCode.USAGE) from exc
    except OSError as exc:
        console.print(f"[red]Serial error: {exc}[/red]")
        raise typer.Exit(ExitCode.DEVICE) from exc
    except ProtocolError as exc:
        console.print(f"[red]Protocol error: {exc}[/red]")
        raise typer.Exit(ExitCode.PROTOCOL) from exc

    out_dir.mkdir(parents=True, exist_ok=True)
    h = decoded.header
    stamp = h.start.strftime("%Y%m%d-%H%M%S")
    base = out_dir / f"log{log_index}-{stamp}"
    meta_path = base.with_suffix(".meta.txt")
    alt_path = base.with_suffix(".alt.txt")
    hr_path = base.with_suffix(".hr.txt")
    hdr_path = base.with_suffix(".header.bin")

    beats_path = base.with_suffix(".beats.txt")
    hdr_path.write_bytes(h.raw)
    alt_path.write_text(
        "\n".join(str(v) for v in decoded.altitude_m) + "\n", encoding="utf-8"
    )
    hr_path.write_text(
        "\n".join(str(v) for v in decoded.heartrate_bpm) + "\n", encoding="utf-8"
    )
    if decoded.hr_beats:
        beats_path.write_text(
            "\n".join(str(b) for b in decoded.hr_beats) + "\n", encoding="utf-8"
        )
    meta_path.write_text(
        "\n".join(
            [
                f"index={log_index}",
                f"header_page=0x{decoded.header_page:02x}",
                f"header_addr=0x{page_to_address(decoded.header_page):04x}",
                f"start={h.start.isoformat(sep=' ')}",
                f"duration_s={h.duration_s}",
                f"interval_s={h.sample_interval_s}",
                f"sample_count={h.sample_count}",
                f"alt_range_m=[{h.min_altitude_m}, {h.max_altitude_m}]",
                f"alt_pages={[f'0x{p:02x}' for p in decoded.alt_pages]}",
                f"hr_pages={[f'0x{p:02x}' for p in decoded.hr_pages]}",
                f"altitude_samples={len(decoded.altitude_m)}",
                f"hr_samples={len(decoded.heartrate_bpm)}",
                f"hr_beats={len(decoded.hr_beats)}",
                "",
            ]
        ),
        encoding="utf-8",
    )
    console.print(f"[green]Log {log_index}[/green] {h.start.isoformat(sep=' ')}")
    console.print(
        f"  duration={h.duration_s}s interval={h.sample_interval_s}s "
        f"samples={h.sample_count}"
    )
    console.print(
        f"  alt n={len(decoded.altitude_m)} "
        f"range=[{min(decoded.altitude_m) if decoded.altitude_m else '?'},"
        f"{max(decoded.altitude_m) if decoded.altitude_m else '?'}]"
    )
    if decoded.heartrate_bpm:
        console.print(
            f"  hr n={len(decoded.heartrate_bpm)} "
            f"range=[{min(decoded.heartrate_bpm)},{max(decoded.heartrate_bpm)}] "
            f"(approx from beats)"
        )
    written = [meta_path.name, alt_path.name, hr_path.name, hdr_path.name]
    if decoded.hr_beats:
        written.append(beats_path.name)
    console.print(f"  wrote {', '.join(written)} → {out_dir}")
    raise typer.Exit(ExitCode.OK)


@app.command("pull")
def pull(
    out_dir: Path = typer.Option(..., "--out-dir", help="Directory for exported logs."),
    device: str = typer.Option("/dev/ttyUSB0", "--device", help="Serial device path."),
    baud: int = typer.Option(115200, "--baud", help="Serial baud rate (per vendor/t6-0.5.c)."),
    log_index: int | None = typer.Option(None, "--log", help="Download single log index."),
    all_logs: bool = typer.Option(False, "--all", help="Download all logs on device."),
    fmt: str = typer.Option(
        "xml",
        "--format",
        help="Output format: xml (STM, default) or json (structured session).",
    ),
    dry_run: bool = typer.Option(False, "--dry-run", help="Probe device only."),
    wristop_id: str | None = typer.Option(
        None,
        "--wristop-id",
        help="WRISTOPID / deviceId (default: u32 BE of 4 bytes at 0x005A).",
    ),
    write_beats: bool = typer.Option(
        False,
        "--write-beats",
        help="Also write {logId}.beats.txt (raw RR intervals in ms) next to export.",
    ),
    force: bool = typer.Option(
        False,
        "--force",
        help="Overwrite existing {logId}.{format} files (default: skip known logIds).",
    ),
    verbose: bool = typer.Option(False, "--verbose", "-v", help="Verbose logging."),
) -> None:
    """Export logs as Training Manager XML or structured JSON."""
    if fmt not in {"xml", "json"}:
        console.print("[red]--format must be xml or json[/red]")
        raise typer.Exit(ExitCode.USAGE)
    export_fmt: ExportFormat = "json" if fmt == "json" else "xml"

    if not dry_run and not (all_logs or log_index is not None):
        console.print("[red]Specify --all or --log INDEX[/red]")
        raise typer.Exit(ExitCode.USAGE)

    _require_device(device)

    try:
        with SerialTransport(device, baudrate=baud, timeout=3.0) as transport:
            if verbose:
                console.print(f"[dim]Opened {device} @ {baud} baud[/dim]")
            dev = SuuntoDevice(transport)
            # Identity first (serial/firmware/model) — also used for device.json.
            identity = dev.get_identity(extra_commands=False)
            if verbose:
                console.print(
                    f"[dim]GetVersion: {identity.version.raw.hex(' ')} "
                    f"model={identity.model} serial={identity.serial}[/dim]"
                )
            logs = dev.list_logs()
            if dry_run:
                console.print("[green]Dry run OK — GetVersion + log directory read.[/green]")
                console.print(
                    f"  version: {identity.version.raw.hex(' ')} "
                    f"({identity.firmware_hint or '?'})"
                )
                console.print(f"  model: {identity.model}  serial: {identity.serial}")
                console.print(f"  logs on device: {len(logs)}")
                for log in logs:
                    lid = log.header.log_id()
                    exists = existing_export_path(out_dir, lid, export_fmt)
                    mark = "exists" if exists else "new"
                    console.print(f"  [{log.index}] {lid} ({mark})")
                raise typer.Exit(ExitCode.OK)

            # device.json sidecar for importers / UI labels without re-querying USB.
            wid = wristop_id if wristop_id is not None else identity.serial
            device_path = write_device_identity_sidecar(
                out_dir,
                identity.to_recording_device_identity(hardware_id=wid),
                force=True,
            )
            if verbose:
                console.print(f"[dim]Device sidecar → {device_path}[/dim]")
            else:
                console.print(f"[dim]Wrote {device_path.name}[/dim]")

            indices = list(range(len(logs))) if all_logs else [int(log_index)]
            exported = 0
            skipped = 0
            for index in indices:
                if index < 0 or index >= len(logs):
                    console.print(
                        f"[red]Log index {index} out of range 0..{len(logs) - 1}[/red]"
                    )
                    raise typer.Exit(ExitCode.USAGE)
                summary = logs[index]
                log_id = summary.header.log_id()
                # Fast path: skip without full decode when target already present.
                if not force and existing_export_path(out_dir, log_id, export_fmt):
                    console.print(
                        f"[dim]Skipped[/dim] log {index} {log_id} "
                        f"(already in {out_dir})"
                    )
                    skipped += 1
                    continue
                path, written = dev.export_log(
                    index,
                    out_dir,
                    wristop_id=wristop_id,
                    write_beats=write_beats,
                    fmt=export_fmt,
                    force=force,
                )
                if not written:
                    console.print(
                        f"[dim]Skipped[/dim] log {index} {log_id} "
                        f"(already in {out_dir})"
                    )
                    skipped += 1
                    continue
                extra = ""
                beats = path.with_suffix(".beats.txt")
                if write_beats and beats.is_file():
                    extra = f" (+ {beats.name})"
                console.print(f"[green]Exported[/green] log {index} → {path}{extra}")
                exported += 1
            if verbose or (exported and skipped):
                console.print(
                    f"[dim]Done: {exported} exported, {skipped} skipped "
                    f"(use --force to overwrite).[/dim]"
                )
            raise typer.Exit(ExitCode.OK)
    except typer.Exit:
        raise
    except OSError as exc:
        console.print(f"[red]Serial error: {exc}[/red]")
        raise typer.Exit(ExitCode.DEVICE) from exc
    except ProtocolError as exc:
        console.print(f"[red]Protocol error: {exc}[/red]")
        raise typer.Exit(ExitCode.PROTOCOL) from exc


@app.command("extract-dmslog")
def extract_dmslog(
    capture: Path = typer.Argument(
        ...,
        exists=True,
        dir_okay=False,
        readable=True,
        help="Path to a Free Serial Analyzer / DMS .dmslog8 capture.",
    ),
    out_dir: Path = typer.Option(
        None,
        "--out-dir",
        help="Directory for extracted artifacts (default: <capture>.extracted/).",
    ),
    require_context: bool = typer.Option(
        False,
        "--require-context",
        help="Drop frames that lack DMS FILETIME/IRP context (stricter).",
    ),
    verbose: bool = typer.Option(False, "--verbose", "-v", help="Print per-command counts."),
) -> None:
    """Extract Suunto D9 frames from a proprietary .dmslog8 serial capture."""
    if out_dir is not None:
        destination = out_dir
    else:
        destination = capture.with_suffix(capture.suffix + ".extracted")
    try:
        frames = extract_file(capture, require_context=require_context)
    except OSError as exc:
        console.print(f"[red]Failed to read capture: {exc}[/red]")
        raise typer.Exit(ExitCode.USAGE) from exc

    if not frames:
        console.print("[yellow]No D9 frames found — wrong file or empty capture?[/yellow]")
        raise typer.Exit(ExitCode.DECODE)

    paths = write_outputs(frames, destination, stem=capture.stem)
    console.print(f"[green]Extracted {len(frames)} frames → {destination}[/green]")
    for label, path in paths.items():
        size = path.stat().st_size
        console.print(f"  {label:10s} {path} ({size} bytes)")

    if verbose:
        counts: dict[int, int] = {}
        for frame in frames:
            counts[frame.command] = counts.get(frame.command, 0) + 1
        for cmd, count in sorted(counts.items()):
            console.print(f"  cmd 0x{cmd:02x}: {count}")

    raise typer.Exit(ExitCode.OK)


@app.command("analyze-extract")
def analyze_extract(
    jsonl: Path = typer.Argument(
        ...,
        exists=True,
        dir_okay=False,
        readable=True,
        help="Path to extract-dmslog *.jsonl output.",
    ),
    out: Path = typer.Option(
        None,
        "--out",
        help="Write report to this path (default: stdout + <jsonl>.analysis.md).",
    ),
    memory_bin: Path = typer.Option(
        None,
        "--memory-bin",
        help="Optional path for sparse-rebuilt memory image (0xFF gaps).",
    ),
) -> None:
    """Summarise extracted frames: log directory, headers, identity reads."""
    report = analyze_jsonl(jsonl)
    destination = out if out is not None else jsonl.with_suffix(".analysis.md")
    destination.write_text(report, encoding="utf-8")
    console.print(report)
    console.print(f"[dim]Wrote {destination}[/dim]")
    if memory_bin is not None:
        frames = load_frames_jsonl(jsonl)
        reads = collect_memory_reads(frames)
        size = write_memory_blob(reads, memory_bin)
        console.print(f"[dim]Wrote {memory_bin} ({size} bytes span)[/dim]")
    raise typer.Exit(ExitCode.OK)


def run() -> None:
    try:
        app()
    except typer.Exit as exc:
        sys.exit(exc.exit_code)


if __name__ == "__main__":
    run()