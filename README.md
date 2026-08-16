# ambit-app

Interoperability reverse engineering, to send GPX routes to a **Suunto Ambit3** without
Movescount, which is dead, without an account and without a server.

The binary format of the watch's navigation database is decoded and verified byte for byte
against USB captures of SuuntoLink. The serializer exists in Python and in C, the latter
written to drop into openambit's `libambit` unmodified.

**It works on hardware.** On 2026-08-04 a route built from a GPX file alone was written to a real
Ambit3 over USB, and the watch shows it with its waypoints. What remains is packaging: Android
USB-OTG, then Bluetooth, then iOS.

- [Documentation site](docs/index.md) (`mkdocs serve` to browse locally) — tutorials, how-to
  guides, reference and explanations, organized per [Diataxis](https://diataxis.fr/).
- [`docs/tutorials/runbook.md`](docs/tutorials/runbook.md) — step-by-step instructions for whoever has the watch.
- [`HANDOFF.md`](HANDOFF.md) — project state, prerequisites and remaining work. **Start here** -
  it also has a pointer near the top for whoever is building the app specifically.
- [`tools/README.md`](tools/README.md) — format specification and tooling usage.
- [`docs/explanation/history.md`](docs/explanation/history.md) — watch-family background (codenames, hardware), the
  Movescount/Suunto-app timeline, and adjacent open-source/reference material
  (openambit, opensportsync, marguslt's writeups, AmbitConnect/AmbitSync).

A few other top-level `.md` files are earlier drafts or preliminary research, superseded by
`HANDOFF.md` - each says so at its own top if you open it directly. Beyond the original
GPX/route goal, this repo also has verified-on-hardware work on recorded-move export and AGPS
data, plus a paused investigation into recreating Movescount's training-plan feature - see
`HANDOFF.md`'s "Work done beyond these 8 milestones" section for all of it; none of it is
required for the core GPX-over-cable-and-Bluetooth deliverable.

```
make -C csrc && python3 tools/selftest.py
```

The analysis artifacts (captures, SuuntoLink binaries, decompiled APK) are not versioned:
proprietary software and personal data. See `HANDOFF.md`.

Interoperability with owned hardware, to put one's own data back on it after a service was
shut down. No protection is circumvented.

## Building and installing

> **Under testing.** Everything below is a work in progress and is provided for testing
> only. Use it on your own hardware, at your own risk.

### Desktop (Qt 6 / QML)

Prerequisites: Qt 6.5+ and CMake, plus `maplibre-native-qt` (built from source — no packaged
version exists) for the map. See [`desktop/README.md`](desktop/README.md) for the exact
package list and the `aqtinstall` setup used on the reference machine.

```
./build-desktop.sh      # cmake -S desktop -B desktop/build && cmake --build desktop/build
./run-desktop.sh        # starts the Python backend on :8766, then launches the app
```

The build produces the binary at `desktop/build/ambitapp`.

| Platform | Command / output | Status |
|----------|------------------|--------|
| **Linux** | `./build-desktop.sh` → `desktop/build/ambitapp` | ✅ Built and run on real hardware (Linux Mint, Qt 6.12.0) |
| **Windows** | `cmake -S desktop -B desktop/build && cmake --build desktop/build` → `desktop/build/ambitapp.exe` | ⚠️ Not tested yet |
| **macOS** | `cmake -S desktop -B desktop/build && cmake --build desktop/build` → `desktop/build/AmbitApp.app` | ⚠️ Not tested yet |

The build should work the same way on Windows and macOS with Qt 6.5+ and CMake installed,
but **the Windows and macOS builds have not been tested yet** — only the Linux build is
confirmed on real hardware.

### Android

The simplest path is **not to build it yourself** — grab the prebuilt testing APK:

1. Go to the [Releases page](https://github.com/skinnie/sommet/releases/latest) and download
   the latest `app-release-testing.apk`.
2. Copy it to your Android device and install it (you may need to allow "Install from
   unknown sources").

This is a signed release-testing build, self-contained — it does **not** need a Metro
development server running (a `debug` APK would, so it is not the one to hand out).

To build it yourself instead:

Prerequisites: Node ≥ 22.11, Android SDK (compileSdk 36, minSdk 28), NDK `27.1.12297006`.

```
cd android && npm install
cd ..
./build-android.sh              # debug APK, installable straight over adb
./build-android.sh release      # release APK (needs a real signing config)
```

The script prints the resulting APK path (under
`android/android/app/build/outputs/apk/`). Install a debug build with
`adb install -r <path>`.

### Firmware flashing — urgency only

Flashing watch firmware from the app **is possible and has been verified on real hardware**
(an Ambit3 Peak was flashed and recovered end to end over USB). Even so, **we only recommend
it in an emergency** — when a watch needs firmware and no computer with SuuntoLink is
available. For a normal firmware update, use SuuntoLink; the in-app flasher is a fallback,
not the default path.

This is **especially true on Android**, where flashing goes over a USB-OTG cable: OTG cables
and adapters are unreliable, and USB power delivery during the flash can be marginal. A
failure mid-flash can leave the watch in bootloader mode.

Whenever you do flash — desktop or Android — make sure the **phone/computer, the watch, and
(on Android) everything on the OTG chain are fully charged** before you start, and don't
interrupt it.

## License and credits

[GPLv3](LICENSE) - the same license as [openambit](https://github.com/openambitproject/openambit),
whose real, working `libambit` this project checks its own reverse-engineering against
throughout.

See [`docs/reference/credits.md`](docs/reference/credits.md) for the people and projects this work builds on: openambit,
opensportsync, marguslt, sebchastang, the Suunto forum community, and wanarun.net.
