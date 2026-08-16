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

There are two apps in this repo: a **desktop** app (Qt 6 / QML, for Linux / macOS /
Windows) and an **Android** app (React Native). Both talk to a watch over USB; the Android
app additionally supports Bluetooth. Start by cloning:

```
git clone https://github.com/skinnie/sommet.git ambit-app
cd ambit-app
```

### Android

**The recommended path is to install the prebuilt APK — you do not need to build anything.**

1. On your Android device, open the [latest release](https://github.com/skinnie/sommet/releases/latest)
   and download `app-release-testing.apk`.
2. Tap the downloaded file to install it. The first time, Android will ask you to allow
   "Install from unknown sources" for your browser/file manager — allow it, then retry.
3. To sync over USB you also need a **USB-OTG cable/adapter** between the phone and the
   watch; Bluetooth needs no cable.

This is a signed, self-contained release build — it runs on its own, with **no Metro
development server** required.

<details>
<summary><b>Building the release APK yourself</b></summary>

Prerequisites:
- **Node** ≥ 22.11 and npm
- **Java JDK 17** (for Gradle)
- **Android SDK** with `compileSdk 36`, `minSdk 28`, and **NDK `27.1.12297006`**
  (Gradle downloads the NDK/CMake automatically if the SDK command-line tools are set up).
  Set `ANDROID_HOME` (or `ANDROID_SDK_ROOT`) to your SDK path.
- A **signing config** — a release APK must be signed to install on a device.

```
cd android && npm install && cd ..

./build-android.sh release      # release APK
```

The script prints the finished APK's path (under
`android/android/app/build/outputs/apk/release/`). Install it on a connected device with:

```
adb install -r <path-to-apk>
```

</details>

### Desktop (Linux / macOS / Windows)

**Windows and macOS users: you don't need to build anything.** Each GitHub release carries
a ready-made **Windows `.zip`** (unzip, double-click `ambitapp.exe`) and **macOS `.dmg`**
(open, drag to Applications) built automatically in the cloud — see the
[latest release](https://github.com/skinnie/sommet/releases/latest). They are unsigned, so
the first launch shows a one-time "unverified developer" prompt: on macOS right-click the
app → Open → Open; on Windows click "More info" → "Run anyway".

> **Note:** the watch engine (the Python helper) is bundled inside these downloads and the
> app starts it automatically, so no separate setup is needed. This end-to-end packaging is
> new and **not yet confirmed against a real watch on Mac/Windows** — if a download misbehaves,
> building from source with `run-desktop.sh` (below) is the proven path.

To build it yourself (the only path on Linux):

The desktop app is Qt 6 / QML with a small stdlib-only Python backend that does the actual
USB work. Prerequisites (all three platforms):
- **Qt 6.5+** and **CMake** (3.21+) with a C++ compiler
- **Python 3.8+** on `PATH` (runs the backend — no pip packages needed, stdlib only)

That's the whole list — the map is drawn with plain Qt, so there is **no extra native
library to build** (an earlier MapLibre dependency was removed; see `desktop/CMakeLists.txt`).

Build, then run:

```
./build-desktop.sh      # = cmake -S desktop -B desktop/build && cmake --build desktop/build
./run-desktop.sh        # starts the Python backend on :8766, then launches the app
```

**Run it with `run-desktop.sh`, not the bare binary** — the app does not spawn its own
backend, so launching `desktop/build/ambitapp` directly shows "backend not running".

Per-platform build command and output (the two helper scripts are Linux/macOS shell
scripts; on Windows run the raw `cmake` commands):

| Platform | Command | Output | Status |
|----------|---------|--------|--------|
| **Linux** | `./build-desktop.sh` | `desktop/build/ambitapp` | ✅ Built and run on real hardware (Linux Mint, Qt 6.12.0) |
| **macOS** | `cmake -S desktop -B desktop/build && cmake --build desktop/build` | `desktop/build/AmbitApp.app` | ⚠️ Should work; not tested yet |
| **Windows** | `cmake -S desktop -B desktop/build && cmake --build desktop/build` | `desktop/build/ambitapp.exe` | ⚠️ Should work; not tested yet |

On macOS and Windows, start the backend yourself before launching the binary:
`cd desktop/backend && python3 server.py` (use `python` on Windows). Only the **Linux**
build is confirmed on real hardware so far.

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
