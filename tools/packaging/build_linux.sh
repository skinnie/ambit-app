#!/bin/bash
# Builds the standalone Linux executable. Run this ON Linux - PyInstaller does not
# cross-compile, so this cannot be run from Windows or Mac to produce a Linux build.
#
# Auto-detects Python and PyInstaller; installs PyInstaller into a local, throwaway venv
# (tools/packaging/.build-venv) if it's missing, rather than touching any system/user Python
# install - sidesteps modern distros' "externally managed environment" pip restriction
# (PEP 668) entirely, since a venv is always installable-into regardless of that policy.

set -e
cd "$(dirname "$0")/../.."

PYTHON=python3
if ! command -v "$PYTHON" >/dev/null 2>&1; then
    echo "Python 3 wasn't found on this system."
    echo "Install it with your distro's package manager, e.g.:"
    echo "  Debian/Ubuntu: sudo apt install python3 python3-venv"
    echo "  Fedora:        sudo dnf install python3"
    echo "  Arch:          sudo pacman -S python"
    echo "Or see https://www.python.org/downloads/ - then run this script again."
    exit 1
fi

VENV="tools/packaging/.build-venv"
if [ ! -x "$VENV/bin/pyinstaller" ]; then
    echo "Setting up a local build environment (one-time) in $VENV ..."
    "$PYTHON" -m venv "$VENV"
    "$VENV/bin/pip" install --quiet --upgrade pip
    "$VENV/bin/pip" install --quiet pyinstaller
fi

"$VENV/bin/pyinstaller" --clean --distpath dist/linux --workpath build/linux \
    tools/packaging/workout_builder.spec
echo
echo 'Done. The standalone app is at dist/linux/Ambit3 Workout Builder'
