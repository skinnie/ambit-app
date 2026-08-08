# PyInstaller spec for the standalone Ambit3 Workout Builder desktop app.
#
# `workout_gui.py` and its two imports (`workout.py`, `suuntolink_catalog.py`) are pure
# standard-library Python - no third-party dependencies to bundle, which is what makes this
# spec this short. Build ON each target platform (PyInstaller does not cross-compile) - see
# packaging/README.md for the exact commands and the macOS universal2 (Intel + Apple Silicon
# in one build) note.
#
#   pyinstaller --clean tools/packaging/workout_builder.spec
#
# macOS architecture: read from an environment variable, not a CLI flag - PyInstaller ignores
# most CLI build options once you hand it an existing .spec file (a real, easy-to-hit gotcha;
# --target-architecture on the command line here would be silently ignored).
#
#   PYINSTALLER_TARGET_ARCH=universal2 pyinstaller --clean tools/packaging/workout_builder.spec

import os
import sys
from pathlib import Path

TOOLS_DIR = Path(SPECPATH).parent  # tools/, so workout.py/suuntolink_catalog.py import cleanly
TARGET_ARCH = os.environ.get("PYINSTALLER_TARGET_ARCH")  # None, "universal2", "arm64", "x86_64"

# This project's own original icon (tools/packaging/make_icon.py) - deliberately not any real
# Suunto asset, see that script's docstring for why.
ICON_ICO = str(Path(SPECPATH) / "icon.ico")    # Windows
ICON_ICNS = str(Path(SPECPATH) / "icon.icns")  # macOS

block_cipher = None

a = Analysis(
    [str(TOOLS_DIR / "workout_gui.py")],
    pathex=[str(TOOLS_DIR)],
    binaries=[],
    datas=[],
    hiddenimports=[],
    hookspath=[],
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name="Ambit3 Workout Builder",
    console=False,       # no terminal window - it opens a browser tab instead
    upx=False,           # keep it simple/reproducible; UPX saves space, not needed here
    target_arch=TARGET_ARCH,  # macOS only; harmless elsewhere
    icon=ICON_ICO,       # Windows reads this directly off EXE(); ignored on other platforms
)

if sys.platform == "darwin":
    app = BUNDLE(
        exe,
        name="Ambit3 Workout Builder.app",
        bundle_identifier="app.ambit.workoutbuilder",
        icon=ICON_ICNS,
    )
