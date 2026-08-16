# Packaging the Workout Builder as a standalone app

Turns `tools/workout_gui.py` (a local web server + browser UI, stdlib-only, no third-party
dependencies) into a real double-click app for Windows, macOS and Linux, via
[PyInstaller](https://pyinstaller.org/). The Linux build is done and verified end to end
(build + run + a live compile through the network, all from the frozen executable, in
`dist/linux/`) - the mechanism is identical cross-platform, but PyInstaller cannot
cross-compile, so the actual Windows/macOS binaries still need building on those OSes.

## What ships

Double-clicking the built app starts a local server on `127.0.0.1:8765` and opens it in your
default browser - the same UI as running `python3 tools/workout_gui.py` directly, just without
needing Python installed separately. It can:

- build a structured workout and compile it into a real Suunto App via the live community
  compiler (`ambitappscompiler.azurewebsites.net`, see `training_program_andre.md` Finding 6) -
  the one thing that needs an internet connection; everything else works offline, including
  revisiting anything already compiled (see "Offline use" below);
- every successful compile is also saved as its own `.json` file in `~/AmbitWorkouts` (all
  three OSes), independent of SuuntoLink or the in-browser History list;
- **Windows/macOS**: "Add to SuuntoLink" appends the compiled result straight into SuuntoLink's
  own `suunto-apps/index.json` (auto-detected per OS) so it shows up in SuuntoLink's own "Add
  Suunto App" picker next time the watch connects - the documented, community-used path
  (`forum.suunto.com/topic/7592`'s first post), not this project's own flash writer, which hit
  an unresolved real "app error" on hardware and is paused (Finding 19). The real `index.json`
  is backed up first, every time, to `index_old.json` next to it (one generation - each write
  overwrites the previous backup with whatever was there right before that write, not the
  original-ever state; ask if you want deeper history kept);
- **Linux**: SuuntoLink doesn't exist for Linux at all, so instead of a doomed "Add to
  SuuntoLink" attempt, the button here is "Open instructions" - it opens a real README
  (`~/AmbitWorkouts/README - read this on Linux.txt`, written fresh on every compile) that
  states exactly where the compiled `.json` files are and walks through copying one to a
  Windows/Mac machine and using "Import compiled JSON" + "Add to SuuntoLink" there. Also notes,
  honestly: running SuuntoLink itself under Wine is theoretically possible (it's an Electron
  app) but untested and unsupported here - Electron apps are historically unreliable under
  Wine, and the copy-the-file route is the one this project has actually verified;
- **"Import compiled JSON"** (Advanced section) closes that loop: load a `.json` compiled
  elsewhere (e.g. built on Linux) into the Windows/Mac app to get a real "Add to SuuntoLink"
  button for it - History (browser `localStorage`) doesn't carry over between machines, so
  without this there'd be no way to act on a file compiled somewhere else.

**Never replace SuuntoLink's `index.json` by hand with a downloaded/saved compiled file.**
Confirmed straight from the original author of this method (Pavel Samokha,
`forum.suunto.com/topic/7592`): "in index.json it's an JSON array, but compiler output is one
json object with assumption that user might want to add it to existing array of apps, not
replacing it completely with one." The compiler's output is deliberately a single object, meant
to be *appended* to the real array (which is exactly what `suuntolink_catalog.py`'s
`add_entry()` does) - replacing the whole file with just that one object breaks SuuntoLink
outright (confirmed on real hardware, 2026-08-06: "unknown error" / "apps not iterable", blank
sport-mode screens). Always use the app's own "Add to SuuntoLink" button; if it ever does go
wrong, `index_old.json` (written right next to the real file on every use) is the way back.

It does **not** touch the watch's flash directly - `workout_install.py` (this project's own
writer) is a separate, CLI-only tool, deliberately not part of this packaged app.

## Offline use

The page itself (HTML/CSS/JS) is fully self-contained - no CDN, no external fonts, nothing -
so building/editing a workout, browsing History, exporting/importing a workout file, "Add to
SuuntoLink" and "Open instructions" all work with no network at all. The one thing that
genuinely can't work offline is the "Create App" compile step itself, since it calls the live
community compiler this project doesn't run a copy of - attempting it offline fails with a
plain "couldn't reach the compiler... you're offline" message rather than a crash. Compile
anything you need while online and it's usable offline from then on (saved to `~/AmbitWorkouts`
and to History automatically).

## One-time setup (per platform)

None, really - each build script now detects Python and PyInstaller itself:

- if Python 3 is missing, Linux/macOS print the right install command for you (macOS also
  opens the download page); Windows tries `winget` automatically, falling back to opening
  the download page if `winget` isn't available either;
- if PyInstaller is missing, it's installed into a throwaway local venv
  (`tools/packaging/.build-venv`) rather than touching your system/user Python - sidesteps
  Debian/Ubuntu's "externally managed environment" pip restriction entirely, since a venv is
  always installable-into regardless of that policy.

`workout_gui.py`, `workout.py` and `suuntolink_catalog.py` are pure standard library - nothing
else to install once PyInstaller is there.

## Building

PyInstaller does not cross-compile - each of the three below has to be built by running its
script *on that OS*. **Linux is already built**, right here, verified working: `dist/linux/
Ambit3 Workout Builder`. Windows and Mac need building on those actual machines - the scripts
below are ready, just run them there.

**Linux** (already done, rebuild any time with):

```
./tools/packaging/build_linux.sh
```

Produces `dist/linux/Ambit3 Workout Builder`. One real caveat specific to this platform:
SuuntoLink has no Linux build at all, so the "Add to SuuntoLink" button will always report
"couldn't find it" here - `suuntolink_catalog.py` knows this and says so plainly rather than
searching pointlessly. The compile half works exactly the same as everywhere else; the
compiled JSON can be copied to a Windows/Mac machine that does run SuuntoLink.

**Windows** (run on Windows):

```
tools\packaging\build_windows.bat
```

Produces `dist\windows\Ambit3 Workout Builder.exe`.

**macOS** (run on a Mac):

```
./tools/packaging/build_mac.sh
```

Produces `dist/mac/Ambit3 Workout Builder.app`, for whichever architecture (Intel or Apple
Silicon) the build machine has, **and copies it straight into `/Applications`** (replacing any
previous copy there) so there's no manual drag-and-drop step. If that copy fails (permissions),
it's left at `dist/mac/Ambit3 Workout Builder.app` for you to move yourself. **For both
architectures from one machine**: install the official universal2 build from python.org (not
Homebrew's, which is single-arch), then:

```
PYINSTALLER_TARGET_ARCH=universal2 ./tools/packaging/build_mac.sh
```

**First launch**: macOS Gatekeeper blocks a plain double-click of an unsigned, unnotarized app
the first time - it looks like nothing happened at all, not like an error dialog. Right-click
the app -> Open -> Open (once) to get past it, or System Settings -> Privacy & Security ->
scroll down -> "Open Anyway". Real code-signing needs an Apple Developer account, out of scope
here. After that first approval, if double-clicking ever still seems to do nothing, check
`~/AmbitWorkouts/app.log` - the packaged app has no visible console window (`console=False` in
the spec), so a startup failure that used to be silent now gets logged there instead.

## Icon

`icon.icns` (macOS) / `icon.ico` (Windows) are this project's own, original design - four
simple bars in an alternating low/high pattern (an interval-training profile), not any real
Suunto asset. Generated by `make_icon.py` (needs Pillow; already run once, the output files
are committed like any other binary asset - a plain Windows/macOS build never needs Pillow
installed). Deliberate choice, not an oversight: using SuuntoLink's own icon (a real one sits
in `assets/mac/Contents/Resources/electron.icns` from the decompiled reference copy) would
look like impersonation and directly contradict the "not affiliated with Suunto" disclaimer
already in the app's own UI. Needs Pillow to (re)generate - reuses the same throwaway build venv `build_mac.sh`/
`build_windows.bat` already set up for PyInstaller, rather than touching system Python:

```
tools/packaging/.build-venv/bin/pip install pillow     # Windows: tools\packaging\.build-venv\Scripts\pip
tools/packaging/.build-venv/bin/python tools/packaging/make_icon.py   # Windows: ...\Scripts\python
```

## Disclaimer

Independent, unofficial software - not affiliated with, endorsed by, or supported by Suunto.
"Suunto" and the watch model names it reports compatibility with are trademarks of their
respective owner, used here only to describe compatibility. Provided as-is, no warranty of any
kind: test carefully before relying on it, and nobody involved in building it is responsible
for any malfunction, data loss, or damage to a watch from using it. This same notice is shown
in the app's own UI.

## Supported operating systems

Checked directly, not guessed - two independent floors, and the *higher* one is what actually
applies to this packaged app, not SuuntoLink's own alone:

| OS | SuuntoLink's own minimum | This app's real minimum | Which one binds |
|---|---|---|---|
| macOS | **10.11** (El Capitan) - read directly from the real `SuuntoLink.app`'s own `Info.plist` (`LSMinimumSystemVersion`, `assets/mac/Contents/Info.plist`) | **10.15** (Catalina) | PyInstaller's own current floor (pyinstaller.org's stated requirements) - higher than SuuntoLink needs, so 10.15 is the real number to publish, not SuuntoLink's 10.11 |
| Windows | Not stated as a single version number anywhere found, but real evidence it supports pre-Windows-10: the real SuuntoLink installer (`assets/WIndows apps/suuntoapp_local/install/windows_ucrt_install.js`) checks the registry for a Windows-10 version key and, if absent, installs the standalone Universal C Runtime redistributable - the standard accommodation for Windows 7 SP1/8/8.1 | **8** | PyInstaller's own stated floor ("PyInstaller runs in Windows 8 and newer") - within what SuuntoLink itself already appears to tolerate, so this is the binding number |
| Linux | N/A - SuuntoLink has no Linux build at all | no hard floor found or expected | most 64-bit distros from the last several years; PyInstaller's Linux requirements are mainly a reasonably current glibc, not a specific named release |

Practical wording for a release page: **macOS 10.15 (Catalina) or later, Windows 8 or later,
64-bit Linux.**

## Toward Android / React Native integration

Not attempted, and deliberately not designed around yet - but the architecture already points
the right way. `workout.py` (the workout-JSON -> App-Zone-source -> live-compiler logic) has
zero GUI or OS dependency; it's a plain function pipeline plus one HTTP POST. `workout_gui.py`
(the local server/browser UI) and `suuntolink_catalog.py` (desktop-OS-specific file surgery on
SuuntoLink's own install) are both intentionally kept separate from it for exactly this reason.

Given this project's base app is React Native (`guiguoz/opensportsync`, per `HANDOFF.md`), the
straightest path when that day comes is almost certainly **porting `workout.py`'s logic to
TypeScript** (it's ~250 lines, no numerical/crypto complexity, just string templating and one
`fetch()` call) rather than embedding a Python runtime in the APK (e.g. via Chaquopy, which
targets native Kotlin/Java apps, not React Native's JS bridge, and would add real size/
complexity for very little gained reuse). `suuntolink_catalog.py`'s feature has no Android
equivalent at all - a phone doesn't run SuuntoLink - so that part simply wouldn't carry over;
whatever install path Android gets would need to be this project's own writer (once Finding
19's real "app error" is actually solved) or something else entirely.
