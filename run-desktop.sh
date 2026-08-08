#!/usr/bin/env bash
# Starts the Python backend (desktop/backend/server.py, http://127.0.0.1:8766) if it isn't
# already running, then launches the desktop app. Real, live gotcha found 2026-08-09: the
# Qt app never spawns the backend itself (checked - no QProcess for it anywhere in
# desktop/src/), so running build-desktop.sh's own binary directly shows "backend not
# running" even though the build itself is fine. This script exists so that doesn't happen
# again.
#
#   ./run-desktop.sh
set -euo pipefail
cd "$(dirname "$0")"

BACKEND_PID=""
if curl -s -o /dev/null -w "" http://127.0.0.1:8766/api/health 2>/dev/null; then
  echo "backend already running on :8766"
else
  echo "starting backend..."
  (cd desktop/backend && python3 server.py) &
  BACKEND_PID=$!
  for _ in $(seq 1 20); do
    curl -s -o /dev/null http://127.0.0.1:8766/api/health 2>/dev/null && break
    sleep 0.25
  done
fi

cleanup() {
  if [ -n "$BACKEND_PID" ]; then
    kill "$BACKEND_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

./desktop/build/ambitapp
