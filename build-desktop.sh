#!/usr/bin/env bash
# Builds the desktop app (Qt6/QML) and prints the resulting binary's path.
# Real build command, from desktop/README.md - see that file for the full prerequisites
# (Qt 6.5+, CMake) if this fails on a fresh machine.
#
#   ./build-desktop.sh
set -euo pipefail
cd "$(dirname "$0")/desktop"

cmake -S . -B build
cmake --build build

echo ""
echo "Binary: $(pwd)/build/ambitapp"
