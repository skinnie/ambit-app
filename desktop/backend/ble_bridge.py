#!/usr/bin/env python3
"""Desktop-app side of the Bluetooth bridge - talks to `tools/ble_server.py listen`, the
process that actually holds the watch's BLE (GATT server) connection open.

WHY THIS EXISTS. `server.py`'s other endpoints work by running a CLI tool
(`write_nav.py`, `sgee.py`, ...) as a fresh subprocess per HTTP request, each one opening
its own USB connection and exiting - fine for a cable that's just always there. BLE can't
work that way: the watch's advertising window is short, the GATT server + D-Bus event loop
have to stay running across many commands, and only one process can host that server at a
time. So `ble_server.py` stays a single long-lived daemon (started once, kept running across
many requests) instead of a per-call subprocess, and this module is the thin client that
talks to it over the Unix control socket `ble_server.py`'s `ControlSocketServer` exposes.
Same shape as the Android side of this project: `AmbitBleModule` owns one persistent
connection, and every other call (`AmbitBleDeviceProvider`, in-app `getLogs`/etc.) just
reaches into it - a Unix socket standing in here for that shared in-process state.

LINUX ONLY, for now. `ble_server.py` hosts the GATT server via BlueZ's D-Bus API, which has
no equivalent on macOS or Windows - each of those needs its own peripheral-mode backend
(CoreBluetooth on macOS, WinRT's GATT server APIs on Windows) behind this same client
interface. Nothing here is Linux-specific by construction; only `ble_server.py` itself is.

DRY-RUN BY DEFAULT, matching every other watch-writing path in this project
(`write_nav.py`, `sgee.py`, `server.py`'s own WATCH_LOCK'd endpoints): connecting only reads
(`command()` calls made read-only unless `confirm: true` is threaded through, same contract
`server.py` already uses for USB). `set_dry_run(False)` is the explicit, one-place opt-in.
"""

import json
import socket
import subprocess
import sys
import threading
import time
from pathlib import Path

TOOLS_DIR = Path(__file__).resolve().parent.parent.parent / "tools"
PYTHON = sys.executable

# Must match tools/ble_server.py's SOCKET_PATH exactly - not re-derived, so the two can never
# drift apart.
SOCKET_PATH = Path.home() / ".cache" / "AmbitApp" / "ble.sock"

# How long to wait for the daemon subprocess to bind its control socket after being spawned.
# Local process startup (Python interpreter + dbus/GLib imports), not a BLE operation - a few
# seconds is generous, not a value tuned against the watch's own timing.
_STARTUP_TIMEOUT_S = 10.0


class BleBridgeError(RuntimeError):
    """Raised for anything the socket protocol itself reports as a failure - a malformed
    request, a command timeout relayed from ServerLink, or the daemon not being reachable at
    all. Callers (server.py's HTTP handlers) catch this the same way they already catch
    subprocess failures from run_tool()."""


class BleBridge:
    """Owns the `ble_server.py listen` subprocess and the socket connection to it.

    One instance per backend process (see the module-level `bridge` singleton below) -
    there is exactly one BLE connection to the watch at a time, same real constraint
    PROJECT_RULES.md notes for pairing itself ("these watches can only be paired with one
    device/app at a time").
    """

    def __init__(self):
        self._lock = threading.Lock()
        self._proc = None
        self._log_path = Path.home() / ".cache" / "AmbitApp" / "ble_daemon.log"

    def is_running(self):
        with self._lock:
            return self._proc is not None and self._proc.poll() is None

    def start(self, forget=False, verbose=True):
        """Spawns the daemon if it isn't already running. Idempotent - a second call while
        one is already up is a no-op, matching `connect()`'s use as "make sure we're
        listening" rather than "start a new session every tap"."""
        with self._lock:
            if self._proc is not None and self._proc.poll() is None:
                return
            self._log_path.parent.mkdir(parents=True, exist_ok=True)
            args = [PYTHON, str(TOOLS_DIR / "ble_server.py"), "listen"]
            if forget:
                args.append("--forget")
            if verbose:
                args.append("--verbose")
            log_file = open(self._log_path, "a", encoding="utf-8")  # noqa: SIM115 - lives as long as _proc
            self._proc = subprocess.Popen(
                args, cwd=str(TOOLS_DIR), stdout=log_file, stderr=subprocess.STDOUT,
                stdin=subprocess.DEVNULL)
        self._wait_for_socket()

    def stop(self):
        """Tears the daemon down. Does not touch the watch's own bond - same "always unpair,
        don't replace" guidance in PROJECT_RULES.md is a watch-menu action, not something
        this does implicitly on every disconnect."""
        with self._lock:
            proc, self._proc = self._proc, None
        if proc is not None and proc.poll() is None:
            proc.terminate()
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                proc.kill()

    def _wait_for_socket(self):
        deadline = time.monotonic() + _STARTUP_TIMEOUT_S
        while time.monotonic() < deadline:
            if SOCKET_PATH.exists():
                try:
                    self._request({"op": "status"}, timeout=2.0)
                    return
                except BleBridgeError:
                    pass                                    # bound but not accepting yet
            if not self.is_running():
                raise BleBridgeError(
                    "ble_server.py exited before opening its control socket - "
                    f"see {self._log_path}")
            time.sleep(0.2)
        raise BleBridgeError(
            f"ble_server.py did not open its control socket within {_STARTUP_TIMEOUT_S}s")

    def _request(self, payload, timeout=20.0):
        if not SOCKET_PATH.exists():
            raise BleBridgeError("BLE daemon is not running (connect first)")
        sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        sock.settimeout(timeout)
        try:
            sock.connect(str(SOCKET_PATH))
            sock.sendall((json.dumps(payload) + "\n").encode("utf-8"))
            buf = b""
            while not buf.endswith(b"\n"):
                chunk = sock.recv(65536)
                if not chunk:
                    raise BleBridgeError("BLE daemon closed the connection")
                buf += chunk
        except OSError as exc:
            raise BleBridgeError(f"could not reach BLE daemon: {exc}") from exc
        finally:
            sock.close()
        response = json.loads(buf.decode("utf-8"))
        if not response.get("ok"):
            raise BleBridgeError(response.get("error", "unknown BLE daemon error"))
        return response

    def status(self):
        """Read-only - safe to poll the way DeviceService's own heartbeat polls USB. Reports
        not-running rather than raising when the daemon was never started, so a caller can
        treat this like any other "is the watch there" check."""
        if not self.is_running():
            return {"running": False, "subscribed": False}
        try:
            response = self._request({"op": "status"}, timeout=3.0)
        except BleBridgeError:
            return {"running": True, "subscribed": False}
        response["running"] = True
        return response

    def set_dry_run(self, value):
        return self._request({"op": "set_dry_run", "value": bool(value)})["dry_run"]

    def command(self, cmd, payload=b"", expect_reply=True, timeout=20.0):
        """`Link.command()`'s shape (command id, payload bytes in, payload bytes out) -
        existing call sites that already know how to talk to a `Link` need nothing new
        beyond swapping which object they call it on."""
        response = self._request({
            "cmd": cmd, "op": "command", "payload_hex": payload.hex(),
            "expect_reply": expect_reply, "timeout": timeout,
        }, timeout=timeout + 5.0)
        return bytes.fromhex(response["payload_hex"])


# One bridge per backend process - see BleBridge's own docstring for why a second is never
# needed. server.py imports this, not the class, for every BLE endpoint.
bridge = BleBridge()
