#!/bin/bash
# Builds the standalone macOS app. Run this ON a Mac - PyInstaller does not cross-compile.
#
# Auto-detects Python and PyInstaller; installs PyInstaller into a local, throwaway venv
# (tools/packaging/.build-venv) if it's missing, rather than touching any system/Homebrew
# Python install.
#
# For an Intel + Apple Silicon build from one machine (e.g. the M4 in this project's own
# hardware list), you need a "universal2" CPython, which only python.org's own installer
# ships (Homebrew's is arch-specific - check with `python3 -c "import platform;
# print(platform.machine())"`: Homebrew always answers with just the host's own arch, never
# "universal2"). Get the official installer from https://www.python.org/downloads/macos/,
# then:
#
#   PYINSTALLER_TARGET_ARCH=universal2 ./tools/packaging/build_mac.sh
#
# Without that environment variable (e.g. using Homebrew's Python on the M4), this produces a
# single-arch build for whatever machine you built it on - real and correct for that machine,
# but won't run on the other architecture.

set -e
cd "$(dirname "$0")/../.."

PYTHON=python3
if ! command -v "$PYTHON" >/dev/null 2>&1; then
    echo "Python 3 wasn't found on this Mac."
    echo "Get the official installer (recommended - needed anyway for a universal2 build):"
    echo "  https://www.python.org/downloads/macos/"
    echo "Or with Homebrew (single-arch only): brew install python3"
    echo "Opening the download page..."
    open "https://www.python.org/downloads/macos/" 2>/dev/null || true
    exit 1
fi

VENV="tools/packaging/.build-venv"
if [ ! -x "$VENV/bin/pyinstaller" ]; then
    echo "Setting up a local build environment (one-time) in $VENV ..."
    "$PYTHON" -m venv "$VENV"
    "$VENV/bin/pip" install --quiet --upgrade pip
    "$VENV/bin/pip" install --quiet pyinstaller
fi

"$VENV/bin/pyinstaller" --clean --distpath dist/mac --workpath build/mac \
    tools/packaging/workout_builder.spec

APP="dist/mac/Ambit3 Workout Builder.app"
echo
if rm -rf "/Applications/Ambit3 Workout Builder.app" 2>/dev/null \
    && cp -R "$APP" /Applications/ 2>/dev/null; then
    echo "Done. Installed to /Applications/Ambit3 Workout Builder.app"
else
    echo "Done. Built at $APP - couldn't copy it into /Applications automatically"
    echo "(permissions?), so drag it there yourself, or run it straight from dist/mac/."
fi
echo
echo "First launch: it's unsigned, so Gatekeeper will block a plain double-click the"
echo "first time (\"cannot be opened because the developer cannot be verified\"). Either"
echo "right-click the app -> Open -> Open (once), or System Settings -> Privacy & Security"
echo "-> scroll down -> \"Open Anyway\"."
