#!/usr/bin/env python3
"""REAL firmware writer for the Ambit3 / Kailash family - THE ONE WRITE THAT CAN BRICK.

Sends the firmware-install sequence reverse-engineered in `firmware_flash.py` (which is
dry-run only) to real hardware. This file is the only place in the project that transmits
a firmware opcode. Per the standing never-touch-firmware rule it must only ever be run
with André present and an explicit, per-attempt go-ahead.

Safety design, in order of how far it goes:
  * default (no flag)  : connect, read device, verify the file, build - send NOTHING.
  * --stream-only      : enter BSL, send the header, stream every chunk, then STOP before
                         the commit. Fully recoverable: the watch is left in BSL, the exact
                         state `resumefirmwarekailash` starts from and recovers cleanly.
  * --commit           : the whole sequence including 0x0e03 + 0x0200 - but the commit is
                         only reached if EVERY ack during streaming was the empty ack the
                         real captures show. A framing bug trips the check and aborts while
                         still in BSL, before anything is flashed.

Framing is reproduced exactly from the captures: 0x0102 uses send_recv=1 (not the default
5); the sequence counter is reset to 0 at 0x0102 (0x0e00=1, chunks=2..., commit, reboot),
as SuuntoLink does. The 0x0e00 prefix's free first u32 is a fresh host tick (proven
ignored by the watch). The 32-byte header and payload are the file's own bytes, unmodified.

END-TO-END STANDALONE WORKFLOW (no SuuntoLink) - the firmware FILE is obtained by
`firmware_check.py`, which already talks to Suunto's real device-info service and downloads
the official image (an SFI2ST container, despite the .zip name):

    # 1. download the latest official firmware for the connected, healthy watch:
    ./tools/firmware_check.py --download /tmp/emu.zip
    # 2. flash it:
    ./tools/firmware_write.py /tmp/emu.zip --expect-model Emu --commit

RECOVERY CAVEAT: a watch stuck in BSL reports model "BSL" (fw 1.6.13, the bootloader), so
`firmware_check.py` cannot read its real model/hw to pick the right image. Download BEFORE
it goes into BSL, or name the target explicitly:

    ./tools/firmware_check.py --model Emu --hw 70.2.17414 --download /tmp/emu.zip
    ./tools/firmware_write.py /tmp/emu.zip --expect-model Emu --commit   # resumes from BSL
"""

import argparse
import signal
import struct
import sys
import time

from ambit_pcap import encode_message
from device_info import read_device_info, read_battery
from firmware_flash import (CHUNK, HEADER_LEN, parse_container, session_tick,
                            CMD_FW_BOOTLOADER, CMD_FW_MODE, CMD_FW_HEADER,
                            CMD_FW_DATA, CMD_FW_COMMIT, CMD_FW_REBOOT)
from write_nav import Link, PRODUCT_IDS


def pid_for_model(model):
    """The USB product_id whose label names this model (e.g. 'Emu' -> 0x001b), so the whole
    flash targets one watch even if others are on the bus. None if unknown -> open() falls
    back to trying all product_ids."""
    for pid, label in PRODUCT_IDS.items():
        if f"({model})" in label:
            return pid
    return None


# Seconds to wait between the HID reports of one multi-report message. The BSL bootloader
# is minimal firmware and drops interrupt-OUT reports that arrive back-to-back (unlike the
# full application, where fast multi-report writes like 0x0b16 work). SuuntoLink paces the
# 10 reports of each 0x0e01 chunk ~1 ms apart in the real captures; matched here.
REPORT_PACING_S = 0.0015


def read_ack(link, total_timeout=15.0, per_read_ms=1000):
    """Read one reply, retrying until it arrives or `total_timeout` elapses. The single
    read in Link._read_reply() is not robust to a delayed ack: a data chunk's ack comes
    only after the watch erases a flash page (~0.5 s, visible in the capture timing), and
    this hidapi backend returns an empty read on a NAK rather than blocking the full
    timeout - so one read misses it. Loop until the 0x3f head shows up."""
    deadline = time.time() + total_timeout
    while time.time() < deadline:
        head = link.device.read(64, per_read_ms)
        if head and head[0] == 0x3F:
            total, = struct.unpack("<I", bytes(head[16:20]))
            body = bytes(head[20:20 + min(42, total)])
            while len(body) < total:
                more = link.device.read(64, per_read_ms)
                if not more:
                    break
                body += bytes(more[8:8 + min(54, total - len(body))])
            return body
    raise RuntimeError(f"no reply within {total_timeout:.0f}s")


def raw_command(link, command, payload=b"", send_recv=5, fmt=9, ack_timeout=15.0):
    """Like Link.command but lets us pin send_recv/fmt per opcode, and returns the reply
    body. Uses and advances link.sequence so a reset before 0x0102 propagates correctly.
    Paces multi-report writes so the BSL bootloader does not drop reports, and reads the
    ack with retries (see read_ack)."""
    reports = encode_message(command, payload, sequence=link.sequence,
                             send_recv=send_recv, fmt=fmt)
    link.sequence += 1
    for i, report in enumerate(reports):
        if i:
            time.sleep(REPORT_PACING_S)
        link.device.write(report)
    return read_ack(link, total_timeout=ack_timeout)


def expect_empty(reply, what):
    if reply:
        raise RuntimeError(f"{what}: expected an empty ack, got {len(reply)} bytes: "
                           f"{reply[:32].hex()} - aborting BEFORE any commit")


class ChunkStall(Exception):
    """A chunk's write+ack did not finish inside its watchdog window - the USB read or
    write is blocked (seen intermittently on this laptop, not a protocol issue: the real
    capture streams smoothly). Caught by the transfer loop, which reopens and restarts."""


def _watchdog(signum, frame):
    raise ChunkStall("watchdog fired")


def install_watchdog():
    signal.signal(signal.SIGALRM, _watchdog)


def watched(seconds, fn, *args, **kwargs):
    """Run fn under a SIGALRM watchdog. Unlike read_ack's wall-clock loop, the alarm
    interrupts a blocked libusb read/write C call (which can ignore its own timeout when
    the device goes silent), turning a permanent hang into a ChunkStall we can recover
    from. `seconds` must exceed the operation's own expected worst case."""
    signal.alarm(int(seconds))
    try:
        return fn(*args, **kwargs)
    finally:
        signal.alarm(0)


def reopen(link):
    """Close the current HID handle and open a fresh one. Entering/leaving BSL is a real
    USB re-enumeration (the device drops off the bus and comes back with a new address and
    a new iProduct string), so the old handle is stale afterwards - it must be reopened,
    exactly as SuuntoLink re-reads all descriptors after 0x0202."""
    try:
        link.device.close()
    except Exception:
        pass
    fresh = Link(dry_run=False, verbose=False, product_id=getattr(link, "product_id", None))
    fresh.open()
    return fresh


def do_transfer(link, header, payload):
    """One full data transfer from offset 0: 0x0102 (transfer mode) + 0x0e00 (header) +
    every 0x0e01 chunk, each guarded by a SIGALRM watchdog. Raises ChunkStall if a chunk's
    write+ack hangs (e.g. a USB cable jostle stalls the endpoint)."""
    link.sequence = 0
    print("  0x0102 -> transfer mode (send_recv=1)")
    expect_empty(watched(15, raw_command, link, CMD_FW_MODE, b"", send_recv=1),
                 "0x0102 fw-mode ack")
    x = session_tick()
    hdr = struct.pack("<II", x, HEADER_LEN) + header
    print(f"  0x0e00 -> header announce (X=0x{x:08x})")
    expect_empty(watched(15, raw_command, link, CMD_FW_HEADER, hdr), "0x0e00 header ack")

    print(f"  0x0e01 -> streaming {len(payload)} bytes")
    print("    (first chunk erases the whole app-flash, ~57 s; then ~0.1 s/chunk)")
    sent = 0
    for i in range(0, len(payload), CHUNK):
        chunk = payload[i:i + CHUNK]
        first = i == 0
        ack_to = 150.0 if first else 20.0   # first chunk waits out the full-region erase
        dog = 180 if first else 30          # watchdog must exceed the ack window
        expect_empty(watched(dog, raw_command, link, CMD_FW_DATA, chunk, ack_timeout=ack_to),
                     f"0x0e01 chunk at +{i}")
        sent += len(chunk)
        if (i // CHUNK) % 200 == 0 or sent == len(payload):
            print(f"\r    {sent}/{len(payload)} B", end="", flush=True)
    print("\n  streaming complete, every ack was empty (clean).")


def stream_with_restart(link, header, payload, max_restarts=4):
    """Run do_transfer; on a ChunkStall (a stalled USB read/write, typically a cable
    jostle) reopen the still-in-BSL watch and restart the transfer from offset 0. Re-sending
    0x0e00 resets the bootloader to the start (re-incurring the ~57 s erase) - that restart
    is the only recovery the protocol offers, and it is exactly what makes this a robust
    standalone flasher. Give up after max_restarts so a truly dead link can't loop forever."""
    for attempt in range(max_restarts + 1):
        try:
            do_transfer(link, header, payload)
            return link
        except ChunkStall as exc:
            if attempt == max_restarts:
                raise RuntimeError(f"gave up after {max_restarts} restarts: {exc}")
            print(f"\n  !! USB stall ({exc}) on attempt {attempt + 1} - reopening and "
                  "restarting the transfer from the start (keep the cable/watch still)")
            try:
                link = reopen(link)
                info = watched(10, read_device_info, link)
                if info["model"] != "BSL":
                    link, _ = poll_model_reopen(link, "BSL")
            except ChunkStall:
                link = reopen(link)  # best effort; next attempt re-checks state
    return link


def poll_model_reopen(link, want, tries=30, delay=0.5):
    """Reopen the device each attempt until its model string equals `want` - used across a
    re-enumeration (0x0202 into BSL, 0x0200 back to the app). Returns (link, info)."""
    last = None
    for _ in range(tries):
        try:
            link = reopen(link)
            info = read_device_info(link)
            last = info["model"]
            if info["model"] == want:
                return link, info
        except Exception:
            pass
        time.sleep(delay)
    raise RuntimeError(f"device model never became {want!r} across a re-enumeration "
                       f"(last seen {last!r})")


def flash(path, expect_model, do_commit, stream_only, probe_enter=False, diag=False):
    header, payload = parse_container(path)
    n_chunks = (len(payload) + CHUNK - 1) // CHUNK

    link = Link(dry_run=False, verbose=False, product_id=pid_for_model(expect_model))
    link.open()
    info = read_device_info(link)
    in_bsl = info["model"] == "BSL"
    battery = None if in_bsl else read_battery(link)  # 0x0306 is not answered in BSL
    print(f"  connected: model {info['model']}  serial {info['serial']}  "
          f"fw {info['fw_version']}  hw {info['hw_version']}"
          + ("  (already in BSL - resume path)" if in_bsl else f"  battery {battery}%"))
    print(f"  file: {HEADER_LEN}B header + {len(payload)}B payload -> {n_chunks} chunks")

    import watch_registry
    if in_bsl:
        # A BSL watch hides its codename; identify it from the serial we remembered when it
        # last connected in app mode. This is what the GUI recovery picker is built on.
        seen = watch_registry.lookup(info["serial"])
        if seen:
            print(f"  registry: this is {seen['product']} ({seen['codename']}) "
                  f"hw {seen['hw_version']}, last fw {seen.get('last_fw')}")
        else:
            print("  registry: serial not recognized - this watch was never connected in "
                  "app mode, so its model can't be auto-identified in BSL. If you don't have "
                  "the right image, recover it once with SuuntoLink and we'll remember it.")
    else:
        watch_registry.record(info)  # remember serial -> codename/hw for future recovery

    if not in_bsl and info["model"] != expect_model:
        raise SystemExit(f"  ABORT: connected model {info['model']!r} != --expect-model "
                         f"{expect_model!r}. Refusing to flash a mismatched image.")
    if battery is not None and battery < 30:
        raise SystemExit(f"  ABORT: battery {battery}% is under the 30% floor for a flash.")

    if not do_commit and not stream_only and not probe_enter and not diag:
        print("\n  dry connection only: nothing sent. Re-run with --probe-enter (BSL entry "
              "only), --stream-only (safe, stops before commit) or --commit (full flash).")
        return 0

    if in_bsl:
        print("\n  already in BSL: skipping 0x0202 (resume of an earlier BSL entry)")
        if probe_enter:
            print("  --probe-enter: nothing to do, the watch is already in BSL.")
            return 0
    else:
        # --- enter the bootloader (device re-enumerates; reopen the handle) ---
        print("\n  0x0202 -> enter bootloader")
        expect_empty(raw_command(link, CMD_FW_BOOTLOADER), "0x0202 bootloader-enter ack")
        link, _ = poll_model_reopen(link, "BSL")
        print(f"  watch now in BSL (was {info['model']}), handle reopened")

        if probe_enter:
            print("\n  --probe-enter: BSL entry confirmed. Not streaming, not committing. "
                  "The watch is in BSL now (recoverable - --commit finishes, or power-cycle "
                  "to return to the app if no firmware is committed).")
            return 0

    if diag:
        link.sequence = 0
        expect_empty(raw_command(link, CMD_FW_MODE, b"", send_recv=1), "0x0102")
        x = session_tick()
        expect_empty(raw_command(link, CMD_FW_HEADER,
                                 struct.pack("<II", x, HEADER_LEN) + header), "0x0e00")
        reports = encode_message(CMD_FW_DATA, payload[:CHUNK], sequence=link.sequence,
                                 send_recv=5, fmt=9)
        link.sequence += 1
        print(f"  DIAG: writing 1 chunk as {len(reports)} reports, printing write() rc:")
        for i, report in enumerate(reports):
            print(f"    report {i}: write() -> {link.device.write(report)}")
            time.sleep(REPORT_PACING_S)
        print("  DIAG: polling read(64,2000) x10:")
        for k in range(10):
            r = link.device.read(64, 2000)
            print(f"    read {k}: {len(r) if r else 0} bytes"
                  + (f"  {bytes(r[:16]).hex(' ')}" if r else ""))
        print("  DIAG done (no commit).")
        return 0

    # --- stream, with a watchdog per chunk and automatic restart on a USB stall ---
    install_watchdog()
    link = stream_with_restart(link, header, payload)

    if not do_commit:
        print("\n  --stream-only: STOPPING before 0x0e03. Nothing has been flashed; the old "
              "firmware is intact. The watch is in BSL now (recoverable - re-run with "
              "--commit to finish, which resumes from here).")
        return 0

    # --- the one irreversible step ---
    print("\n  >>> COMMIT: 0x0e03 (flash) then 0x0200 (reboot) <<<")
    expect_empty(raw_command(link, CMD_FW_COMMIT, ack_timeout=120.0), "0x0e03 commit ack")
    expect_empty(raw_command(link, CMD_FW_REBOOT, ack_timeout=60.0), "0x0200 reboot ack")
    print("  committed. waiting for the watch to reboot into the application...")
    time.sleep(3)
    link, after = poll_model_reopen(link, expect_model, tries=60, delay=0.5)
    print(f"\n  DONE: back in application. model {after['model']}  fw {after['fw_version']}"
          f"  hw {after['hw_version']}")
    return 0


def main():
    try:
        sys.stdout.reconfigure(line_buffering=True)  # live output when piped to a log
    except Exception:
        pass
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("file", help="firmware container (firmware_check.py --download)")
    ap.add_argument("--expect-model", required=True,
                     help="the connected watch MUST report this model, else abort "
                          "(e.g. Emu). Guards against flashing a mismatched image.")
    g = ap.add_mutually_exclusive_group()
    g.add_argument("--probe-enter", action="store_true",
                    help="only send 0x0202 and confirm the watch re-enumerates into BSL, "
                         "then stop (no streaming, no commit)")
    g.add_argument("--stream-only", action="store_true",
                    help="enter BSL and stream the whole file but STOP before commit "
                         "(brick-proof rehearsal; leaves the watch in BSL)")
    g.add_argument("--commit", action="store_true",
                    help="the full flash including the irreversible commit")
    args = ap.parse_args()
    return flash(args.file, args.expect_model, args.commit, args.stream_only,
                 probe_enter=args.probe_enter)


if __name__ == "__main__":
    sys.exit(main())
