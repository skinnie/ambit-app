# Firmware Flasher — design

A SuuntoLink-independent firmware **flasher and recovery tool** for the whole Ambit3 family
and Kailash. The wire protocol is reverse-engineered and proven end-to-end on real hardware
(Ambit3 Peak "Emu", 2026-08-12); see `ambit_app_firmware_flash_protocol` project memory and
the docstrings in `tools/firmware_flash.py` / `tools/firmware_write.py`.

This document covers how the flasher is packaged for real use — the download step, the watch
registry that makes recovery possible, the recovery decision flow, and the GUI plan.

## The full pipeline (no SuuntoLink)

```
firmware_check.py --download FILE     # fetch the official image from Suunto's service
firmware_write.py FILE --expect-model <codename> --commit   # flash it
```

- **Download** — `firmware_check.py` queries Suunto's real device-info service and downloads
  the official image (an `SFI2ST` container: `[32-byte header][raw payload]`, despite the
  `.zip` name). It needs the watch's **codename + hw version**; it reads them from the
  connected watch, or takes `--model` / `--hw` explicitly.
- **Flash** — `firmware_write.py` sends the install sequence: `0x0202` (enter bootloader,
  the watch USB-re-enumerates to "BSL") → `0x0102` → `0x0e00` (header) → `0x0e01` chunks →
  `0x0e03` commit → `0x0200` reboot. The first chunk triggers a full app-flash erase whose
  ack takes ~57 s; the whole flash is ~10 minutes.

## The problem recovery has to solve

To fetch the right image we need the watch's **codename** (Emu / Finch / Ibisbill / …) and
**hw version**. But a watch stuck in the bootloader reports its model as **"BSL"**, not its
codename — so a bricked watch cannot, by itself, tell us which image it needs.

Crucial detail from our captures: **a BSL watch still reports its serial and hw version.**
Only the codename is hidden. So if we have ever seen this serial before, we know everything.

## Watch registry (`tools/watch_registry.py`)

Every time a watch connects **in app mode**, we record its identity, keyed by serial:

```json
{ "8A153C5111000900": {
    "codename": "Emu", "product": "Ambit3 Peak",
    "hw_version": "70.2.17414", "last_fw": "2.4.17",
    "last_seen": "2026-08-12T04:35:00Z" } }
```

- **Location:** `$AMBIT_APP_DATA/known_watches.json` (default
  `~/.config/ambit-app/known_watches.json`) — shared by every CLI tool and the desktop
  backend.
- **Written from** the connect paths: `device_info.py`, `firmware_check.py` (live read), and
  `firmware_write.py` (app-mode connect). `record()` is a no-op for a BSL watch or a missing
  serial.
- **Read at flash time** via `lookup(serial)` (identify a BSL watch) and `known()` (list for
  the picker).

## Recovery decision flow (what the GUI does at flash time)

1. **Watch in app mode** → codename is known live; update the registry; normal download +
   flash.
2. **Watch in BSL, serial in the registry** → auto-identify → download that codename/hw →
   flash. (Still confirm: *"Recovering Ambit3 Peak (…0900) — proceed?"*)
3. **Watch in BSL, serial not recognized** → show a picker: **"Which watch do you want to
   recover?"**, listing `known()` by product + serial. The user selects the one to restore.
4. **No known watches at all** → show the message:

   > **Can't recognise this watch yet.** If it was never connected to this app, recover it
   > once with SuuntoLink — after that we'll remember it. Don't worry, your watch will be
   > soon ready for new adventures! 🧭

The CLI already prints the registry identification (or the not-recognized note) when it finds
a watch in BSL; the picker and the friendly screen are the GUI surface of the same data.

## GUI integration plan

The flasher becomes a **Firmware** page in the desktop Qt app (and later Android), sharing
these CLI tools as its backend.

- **Progress** — the ~57 s first-chunk erase must show a *"Preparing… this can take a
  minute"* state so the bar doesn't look frozen, then real per-chunk progress, then
  *"Finalising / rebooting"*.
- **Safety copy** — a visible *"Keep the watch connected and still; don't unplug"* warning
  (a cable jostle was our one real failure; the writer now auto-restarts on such stalls).
- **Machine-readable output** — add a `--json` progress mode to `firmware_write.py` (like
  `firmware_check.py --json`) so the front-end parses `{phase, percent, message}` instead of
  scraping text.
- **Rounded components / theme** — per project rule 14, all controls use the `Rounded*`
  components and `ThemedDialog`.

## Cross-device

The protocol is identical over USB for the Ambit3 family and Kailash (Kailash magic
`SFI2STmt`, Ambit3 `SFI2STmp`). `--expect-model` and product-id targeting keep the flasher
locked to one watch when several are on the bus. Traverse / Traverse Alpha are expected to
use the same path (unverified — confirm from a capture before a real flash).

## Status

- ✅ Protocol decoded; dry-run builder byte-exact (`firmware_flash.py --selftest`).
- ✅ Real flasher proven end-to-end on hardware (`firmware_write.py --commit`).
- ✅ Download step (`firmware_check.py`) wired into the documented workflow.
- ✅ Watch registry data layer (`watch_registry.py`) + recording on connect.
- ✅ `--json` progress mode for `firmware_write.py`.
- ✅ GUI Firmware page (`desktop/qml/pages/FirmwarePage.qml`) + backend endpoints
  (`/api/firmware/known`, `/api/firmware/flash` streaming) — built, qmllint-clean, needs a
  real app build + on-hardware run to confirm.
- ⬜ Verify: does Qt's `XMLHttpRequest` deliver the flash stream incrementally (live
  progress) or buffer it to the end? If it buffers, swap the streaming read for a small C++
  `QNetworkAccessManager` service (`readyRead`) or SSE.
- ⬜ Android: same flow once the desktop one is confirmed.
