#!/usr/bin/env python3
"""Decodes/replays the Ambit3 firmware-update wire protocol (bootloader "BSL" mode).

READ-ONLY / --compare ONLY - there is no --write here, on purpose. Two real unknowns
are still open, found 2026-08-08 from `assets/ambit3 pcap/firmware` (2026-07-31, the
only real firmware-install capture in the corpus - NOT `ambit3full`, which is a plain
full-sync capture that happens to also carry the BLE whitelist entry, see
`ambit_app_...` project memory / HANDOFF.md):

  1. **Bootloader entry is never captured.** The capture's very first message already
     gets a "BSL" model string back from 0x0000 device_info - the transition from
     normal mode into the bootloader happened before recording started. USB
     enumeration doesn't change (same idVendor=0x1493/idProduct=0x001b device
     descriptor as `sync`/`ambit3full`, checked directly against both), so whatever
     flips it is an application-layer command over the *same* connection, not a
     re-enumeration - a plain continuous capture starting before SuuntoLink is told to
     update should catch it next time a real update is available. Ghidra's decompile of
     the Movescount native core (`assets/APK/movescountapp/ghidra/libkomposti-ng.so.c`)
     names the real state machine - `SDS::WB::Flasher::Mode` has `UpdateBootloader`(12),
     `UpdateApplication`(14), `ImagePreparation`(16), `FileSynchronization`(15) - but the
     actual wire command that sets it lives in functions Ghidra only resolved as thunks
     (`SDS::WB::FlasherImpl::updateLoop` etc.), not full bodies.
  2. **The first 8 bytes of the 0x0e00 message are a real per-file unknown.** Ruled out
     directly: not the file length, not the payload length, not a plain CRC32 of the
     file, the header, or the payload. Only ever seen for the one captured file/session,
     so it can't be computed for a different firmware download yet - only replayed
     verbatim from a capture that already contains it (`--compare`).

Until both are closed, this tool can only prove the decode against the exact captured
session, not build a new install for a different firmware file. Given HANDOFF.md's
standing rule ("never touch the firmware: that is the only write that can brick it"),
that is treated as a feature, not a gap to route around quickly.

**What IS fully closed, byte-exact, 2026-08-08:** the container format and the chunking.
Despite the `.zip` name/extension (`firmware_check.py`'s own download), the real
downloaded firmware file is not a zip archive - a 32-byte header (`SFI2STmp`/`SFI2STmt`
magic + 24 bytes that differ per build, present but unidentified further - shared prefix
bytes across same-day releases for different models suggest structured fields, not a
pure hash, but not decoded field-by-field) followed directly by the raw payload.
Confirmed: `open(firmware_zip).read()[32:]` equals the exact concatenation of every
outgoing 0x0e01 payload in the capture, in order - the watch receives the file's own
bytes completely unmodified, chunked at 512 bytes (the last chunk short), no
re-encoding of any kind. The real message sequence, all confirmed against the capture:

    0x0102 (empty)                          -- enter firmware-transfer mode (ack empty)
    0x0e00 [8 unknown bytes][32-byte header] -- announces the transfer (ack empty)
    0x0e01 <=512 payload bytes, N times      -- the file's payload, chunked (ack empty)
    0x0e03 (empty)                          -- commit / trigger the real flash+reboot
    0x0200 (empty)                          -- seen right after; watch then re-enumerates
                                                the *application* device_info reply
    0x0102 (empty)                          -- seen again once back in normal mode

    ./tools/firmware_flash.py "assets/Firmware/ambit3peak_Emu-fw_2.4.17-70.2.17414.zip" \\
        --compare "assets/ambit3 pcap/firmware"
"""

import argparse
import pathlib
import sys

from ambit_pcap import messages
from write_nav import Link

CMD_FW_MODE = 0x0102
CMD_FW_HEADER = 0x0E00
CMD_FW_DATA = 0x0E01
CMD_FW_COMMIT = 0x0E03
CMD_FW_REBOOT = 0x0200

HEADER_LEN = 32
CHUNK = 512


def parse_container(path):
    """[32-byte header][raw payload] - see this module's docstring. Despite the
    filename, do not treat this as a zip: `unzip -l` fails on it for real."""
    data = pathlib.Path(path).read_bytes()
    header, payload = data[:HEADER_LEN], data[HEADER_LEN:]
    if not header.startswith(b"SFI2ST"):
        raise ValueError(f"{path}: does not start with the known 'SFI2ST..' magic - "
                          "not a firmware container this tool recognizes")
    return header, payload


def build_messages(header, payload, unknown_prefix):
    """The data-carrying messages only - CMD_FW_MODE/CMD_FW_REBOOT bookend them but
    carry no payload of their own, so main() sends those directly."""
    out = [(CMD_FW_HEADER, unknown_prefix + header)]
    for i in range(0, len(payload), CHUNK):
        out.append((CMD_FW_DATA, payload[i:i + CHUNK]))
    out.append((CMD_FW_COMMIT, b""))
    return out


def compare_with_capture(produced, capture):
    expected = [(m.command, m.payload) for m in messages(capture)
                if not m.incoming and m.command in (CMD_FW_HEADER, CMD_FW_DATA, CMD_FW_COMMIT)]
    if len(produced) != len(expected):
        print(f"\n  FAIL  {len(produced)} messages built against {len(expected)} in the capture")
        return False
    ok = True
    for i, (got, want) in enumerate(zip(produced, expected)):
        if got != want:
            print(f"  FAIL  message {i}: got 0x{got[0]:04x} len={len(got[1])}, "
                  f"want 0x{want[0]:04x} len={len(want[1])}")
            ok = False
    print(f"\n  {'OK   ' if ok else 'FAIL '} {len(produced)} messages compared to {capture}")
    return ok


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("file", help="a downloaded firmware container, e.g. from "
                                 "firmware_check.py --download")
    ap.add_argument("--compare", metavar="CAPTURE",
                     help="checks the rebuilt messages against a real capture - only "
                          "assets/ambit3 pcap/firmware (the file's own source capture) "
                          "will actually match, since the 8-byte 0x0e00 prefix is taken "
                          "from it rather than computed")
    args = ap.parse_args()

    header, payload = parse_container(args.file)
    print(f"  {args.file}: {HEADER_LEN}-byte header + {len(payload)}-byte payload")
    print(f"  header: {header.hex()}")

    if args.compare:
        cap_msgs = messages(args.compare)
        unknown_prefix = next(m.payload[:8] for m in cap_msgs
                               if not m.incoming and m.command == CMD_FW_HEADER)
        print(f"  8-byte 0x0e00 prefix taken from the capture: {unknown_prefix.hex()} "
              "(not independently derivable yet - see this file's docstring)")
    else:
        unknown_prefix = b"\x00" * 8
        print("  no --compare given: the 8-byte 0x0e00 prefix is unknown for this file, "
              "using a placeholder - this sequence cannot be sent for real")

    link = Link(dry_run=True)
    link.command(CMD_FW_MODE, b"")
    for command, chunk_payload in build_messages(header, payload, unknown_prefix):
        link.command(command, chunk_payload, quiet=command == CMD_FW_DATA)
    link.command(CMD_FW_REBOOT, b"")

    total = sum(len(p) for c, p, _ in link.sent if c == CMD_FW_DATA)
    print(f"\n{len(link.sent)} messages, {total} firmware-payload bytes chunked")

    if args.compare:
        produced = [(c, p) for c, p, _ in link.sent
                    if c in (CMD_FW_HEADER, CMD_FW_DATA, CMD_FW_COMMIT)]
        return 0 if compare_with_capture(produced, args.compare) else 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
